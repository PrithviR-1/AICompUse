// Unused-export check (§13.3 "no unused exports"): every named export in src/ must be
// referenced by at least one other file. Generated bindings and entry points are skipped.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: on Windows the pathname is "/D:/…", which breaks path joins.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Repo-relative path with forward slashes on every OS, for the allow/skip lists. */
const toRel = (full) => relative(ROOT, full).split(sep).join("/");
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

// Template literals (e.g. sample Markdown containing code) must not count as declarations.
const stripTemplates = (text) => text.replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``");
const files = walk(SRC).map((full) => ({ rel: toRel(full), source: stripTemplates(readFileSync(full, "utf8")) }));
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
