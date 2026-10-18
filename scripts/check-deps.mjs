// Dependency denylist (§11.12): no animation, 3D or scroll libraries anywhere in the
// dependency graph, including transitive packages recorded in pnpm-lock.yaml.
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const DENY = [/^three$/, /^@react-three\//, /^gsap$/, /^lenis$/, /^@studio-freight\/lenis$/, /^framer-motion$/, /^motion$/];

const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, "utf8"));
const direct = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
const lock = readFileSync(`${ROOT}pnpm-lock.yaml`, "utf8");
const locked = [...lock.matchAll(/^ {2}'?(@?[^@\s':]+(?:\/[^@\s':]+)?)@/gm)].map((m) => m[1]);

const hits = [...new Set([...direct, ...locked])].filter((name) => DENY.some((re) => re.test(name)));
if (hits.length > 0) {
  console.error(`Denylisted dependencies found: ${hits.join(", ")}`);
  process.exit(1);
}
console.log(`Dependency denylist passed (${direct.length} direct, ${new Set(locked).size} locked packages)`);
