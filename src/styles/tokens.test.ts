// WCAG AA contrast check for every text/background token pair in both themes (§11.12).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");

function block(selectorStart: string): Record<string, string> {
  const start = css.indexOf(selectorStart);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const vars: Record<string, string> = {};
  for (const m of css.slice(open + 1, close).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

const dark = block(':root,\n[data-theme="dark"]');
const light = { ...dark, ...block('[data-theme="light"]') };

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ["text", "bg"],
  ["text", "surface-raised"],
  ["text", "surface-bubble"],
  ["text", "surface-active"],
  ["text", "surface-sunken"],
  ["text-muted", "bg"],
  ["text-muted", "surface-raised"],
  ["text-muted", "surface-hover"],
  ["text-muted", "surface-active"],
  ["text-faint", "bg"],
  ["text-faint", "surface-raised"],
  ["accent", "bg"],
  ["accent", "surface-raised"],
  ["accent-contrast", "accent-fill"],
  ["accent-contrast", "accent-fill-hover"],
  ["danger-text", "bg"],
  ["danger-text", "surface-raised"],
  ["danger-contrast", "danger-strong"],
  ["code-fg", "surface-sunken"],
  ["code-comment", "surface-sunken"],
  ["code-keyword", "surface-sunken"],
  ["code-string", "surface-sunken"],
  ["code-number", "surface-sunken"],
  ["code-function", "surface-sunken"],
  ["code-constant", "surface-sunken"],
  ...Array.from({ length: 12 }, (_, i): [string, string] => ["avatar-text", `avatar-${i + 1}`]),
];

describe.each([
  ["dark", dark],
  ["light", light],
])("%s theme", (_name, vars) => {
  it.each(TEXT_PAIRS)("%s on %s meets WCAG AA (4.5:1)", (fg, bg) => {
    expect(vars[fg], `missing --${fg}`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(vars[bg], `missing --${bg}`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(vars[fg], vars[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it("borders are visible against the background (3:1 not required, but distinct)", () => {
    expect(contrast(vars["border"], vars["bg"])).toBeGreaterThan(1.15);
  });
});
