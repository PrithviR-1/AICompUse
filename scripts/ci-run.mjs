// CI helper: runs a command and, if it fails, republishes the tail of its output as a GitHub
// error annotation. Annotations are readable through the public API without a token; raw
// job logs are not, so this keeps Windows-only failures diagnosable.
// Usage: node scripts/ci-run.mjs <command> [args…]
import { spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/ci-run.mjs <command> [args…]");
  process.exit(2);
}

const MAX_LINES = 80;
const tail = [];
const remember = (chunk, out) => {
  out.write(chunk);
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    tail.push(line);
    if (tail.length > MAX_LINES) tail.shift();
  }
};

// Windows needs a shell to resolve .cmd shims (pnpm); cargo/git resolve either way.
const child = spawn(command, args, { shell: process.platform === "win32", stdio: ["inherit", "pipe", "pipe"] });
child.stdout.on("data", (chunk) => remember(chunk, process.stdout));
child.stderr.on("data", (chunk) => remember(chunk, process.stderr));
child.on("error", (err) => {
  console.log(`::error title=ci-run could not start ${command}::${err.message}`);
  process.exit(1);
});
child.on("close", (code, signal) => {
  if (code === 0) process.exit(0);
  const important = tail.filter((l) => /error|panicked|failed|cannot|not found|denied|warning: unused/i.test(l));
  const body = (important.length > 0 ? important.slice(-25) : tail.slice(-25)).join("\n");
  const escape = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const title = `${command} ${args.join(" ")}`.replace(/[:,]/g, " ").slice(0, 120);
  console.log(`::error title=${title} exited ${code ?? signal}::${escape(body)}`);
  process.exit(code ?? 1);
});
