#!/usr/bin/env node
/**
 * Zenza — one-command setup
 * ---------------------------
 * Installs dependencies for the pieces that need them. Run this once after
 * cloning, then see README.md for how to start each piece.
 *
 * Usage:
 *   node setup.js
 *
 * Why this instead of shipping node_modules/ in the zip: better-sqlite3
 * (used by 03-zenza-fid-app) ships platform-specific compiled binaries.
 * A node_modules folder built on one OS/architecture will not run on
 * another — it would just silently fail to start on your developers'
 * machines depending on what they're using. `npm install` fetches the
 * correct build for whichever machine runs it, which is the only version
 * of "included" that actually works everywhere. This script just makes
 * that a single command instead of four.
 */

const { execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = __dirname;

const targets = [
  { dir: "02-zenza-tech-site", label: "Zenza Technology site" },
  { dir: "03-zenza-fid-app", label: "Zenza FID product app" },
];

console.log("\nZenza — installing dependencies for each app that needs them\n");

for (const { dir, label } of targets) {
  const fullPath = path.join(ROOT, dir);
  const pkgPath = path.join(fullPath, "package.json");

  if (!fs.existsSync(pkgPath)) {
    console.log(`  skip  ${label} (${dir}) — no package.json found`);
    continue;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const depCount = Object.keys(pkg.dependencies || {}).length;

  if (depCount === 0) {
    console.log(`  n/a   ${label} (${dir}) — zero dependencies, nothing to install (uses only Node's built-ins)`);
    continue;
  }

  console.log(`  ...   ${label} (${dir}) — installing ${depCount} package(s)`);
  try {
    execSync("npm install --no-audit --no-fund", { cwd: fullPath, stdio: "inherit" });
    console.log(`  done  ${label}\n`);
  } catch (err) {
    console.error(`  FAILED ${label} — see error above. Try running "npm install" manually inside ${dir}/\n`);
    process.exitCode = 1;
  }
}

console.log("Setup complete. Next steps:");
console.log("  cd 02-zenza-tech-site  && npm start   → http://localhost:3000");
console.log("  cd 03-zenza-fid-app    && npm start   → http://localhost:4000");
console.log("  open 01-zenza-inc-site/index.html directly in a browser (no server needed)");
console.log("\nSee README.md for the full picture, and QA-TESTING-REPORT.md for what's been verified.\n");
