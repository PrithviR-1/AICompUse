// UI token check (§11.12, §15.10): components may not hard-code colors, radii, font sizes
// or off-grid spacing. Everything must come from src/styles/tokens.css via Tailwind utilities.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: on Windows the pathname is "/D:/…", which breaks path joins.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Repo-relative path with forward slashes on every OS, for the allow/skip lists. */
const toRel = (full) => relative(ROOT, full).split(sep).join("/");
const SRC = join(ROOT, "src");
const ALLOWED_FILES = new Set(["src/styles/tokens.css", "src/lib/bindings.ts"]);

const RULES = [
  { id: "hex-color", re: /#[0-9a-fA-F]{3,8}\b(?![-\w])/g, msg: "hex color literal" },
  { id: "color-fn", re: /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/g, msg: "color function literal" },
  { id: "palette-class", re: /\b(?:bg|text|border|ring|fill|stroke|outline|from|to|via|shadow|divide|placeholder|caret|accent|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?\b/g, msg: "Tailwind palette color (use a token color)" },
  { id: "arbitrary-color", re: /-\[(?:#|rgb|hsl|oklch|color:)/g, msg: "arbitrary color value" },
  { id: "arbitrary-font", re: /\btext-\[\d/g, msg: "arbitrary font size (use the type scale)" },
  { id: "arbitrary-radius", re: /\brounded(?:-[a-z]{1,2})?-\[\d/g, msg: "arbitrary radius (use a radius token)" },
  { id: "default-radius", re: /\brounded(?:-(?:t|b|l|r|tl|tr|bl|br|s|e))?-(?:xs|sm|md|lg|xl|2xl|3xl|4xl)\b/g, msg: "Tailwind default radius (use a radius token)" },
  { id: "default-font", re: /\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b/g, msg: "Tailwind default font size (use the type scale)" },
  { id: "half-spacing", re: /\b-?(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|right|bottom|left)-\d*\.5\b/g, msg: "spacing off the 4 px grid" },
  { id: "arbitrary-spacing", re: /\b-?(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y)-\[(\d+(?:\.\d+)?)px\]/g, msg: "arbitrary spacing", check: (m) => Number(m[1]) % 4 !== 0 },
  { id: "inline-style-size", re: /\b(?:fontSize|borderRadius|color|background(?:Color)?)\s*:\s*["'`]?\d/g, msg: "inline style literal for a tokenized property" },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, (m, p) => p + " ".repeat(m.length - p.length));
}

const problems = [];
for (const file of walk(SRC)) {
  const rel = toRel(file);
  if (ALLOWED_FILES.has(rel) || rel.startsWith("src/test/")) continue;
  const source = stripComments(readFileSync(file, "utf8"));
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      for (const match of line.matchAll(rule.re)) {
        if (rule.check && !rule.check(match)) continue;
        problems.push(`${rel}:${index + 1}  ${rule.msg}: ${match[0]}`);
      }
    }
  });
}

if (problems.length > 0) {
  console.error(`UI token check failed (${problems.length}):\n` + problems.join("\n"));
  process.exit(1);
}
console.log("UI token check passed");
