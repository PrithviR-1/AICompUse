// Unused-export check (§13.3 "no unused exports"): every named export in src/ must be
// referenced by at least one other file. Generated bindings and entry points are skipped.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const SKIP = new Set(["src/lib/bindings.ts", "src/main.tsx"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((full) => ({ rel: relative(ROOT, full), source: readFileSync(full, "utf8") }));
const declRe = /^export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm;
const listRe = /^export\s+(?:type\s+)?\{([^}]+)\}(?!\s*from)/gm;

const unused = [];
for (const file of files) {
  if (SKIP.has(file.rel) || /\.test\.tsx?$/.test(file.rel) || file.rel.startsWith("src/test/")) continue;
  const names = [...file.source.matchAll(declRe)].map((m) => m[1]);
  for (const m of file.source.matchAll(listRe)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, "");
      if (name) names.push(name);
    }
  }
  for (const name of names) {
    const re = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`);
    const used = files.some((other) => other.rel !== file.rel && re.test(other.source));
    if (!used) unused.push(`${file.rel}: ${name}`);
  }
}

if (unused.length > 0) {
  console.error(`Unused exports (${unused.length}):\n` + unused.join("\n"));
  process.exit(1);
}
console.log("Unused-export check passed");
