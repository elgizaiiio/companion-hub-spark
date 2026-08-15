import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Vercel normally applies the SPA rewrite from vercel.json. These static
// entry points also make every public app route independently addressable,
// even when a deployment's rewrite settings are stale or overridden.
const routes = [
  "/war",
  "/tasks",
  "/servers",
  "/wallet",
  "/101",
  "/staking",
  "/attack-shop",
];

const distDir = resolve("dist");
const appShell = resolve(distDir, "index.html");

if (!existsSync(appShell)) {
  throw new Error("dist/index.html was not generated");
}

for (const route of routes) {
  const target = resolve(distDir, route.slice(1), "index.html");
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(appShell, target);
}

copyFileSync(appShell, resolve(distDir, "404.html"));
console.log(`Created SPA entry points for ${routes.length} routes`);