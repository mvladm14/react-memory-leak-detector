// E2E matrix runner.
//
// 1. Build + pack the detector, then install the TARBALL into the fixture app
//    (a real packaging smoke test — exercises the exports map, `files`, and the
//    dependency classification, which unit tests can't).
// 2. Install the Playwright harness + Chromium.
// 3. Run the leak suite once per combo of:
//       @vitejs/plugin-react  v5 (Babel) | v6 (Oxc)
//       detector engine        oxc | babel
//    Each combo boots a fresh Vite dev server (via Playwright's webServer) with
//    the right env and drives a real headless browser to prove live detection.
//
// Usage:
//   node run.mjs                 # full 2x2 matrix
//   node run.mjs v6:oxc v5:babel # only the listed combos
//   SKIP_INSTALL=1 node run.mjs  # reuse an already-prepared fixture/e2e install

import { execSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const E2E = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(E2E, "..");
const FIXTURE = path.join(E2E, "fixture");

const sh = (cmd, cwd, env) =>
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });

const ALL = [];
for (const PLUGIN_REACT of ["v5", "v6"])
  for (const HEAP_ENGINE of ["oxc", "babel"]) ALL.push({ PLUGIN_REACT, HEAP_ENGINE });

// Optional combo filter from argv, e.g. "v6:oxc".
const wanted = process.argv.slice(2);
const combos = wanted.length
  ? ALL.filter((c) => wanted.includes(`${c.PLUGIN_REACT}:${c.HEAP_ENGINE}`))
  : ALL;
if (!combos.length) {
  console.error(`No combos matched ${JSON.stringify(wanted)}. Valid: ${ALL.map((c) => `${c.PLUGIN_REACT}:${c.HEAP_ENGINE}`).join(", ")}`);
  process.exit(2);
}

if (!process.env.SKIP_INSTALL) {
  console.log("→ Building + packing the detector…");
  sh("npm run build", ROOT);
  // Clean any stale tarballs so the glob below is unambiguous.
  for (const f of readdirSync(E2E))
    if (/^react-memory-leak-detector-.*\.tgz$/.test(f)) rmSync(path.join(E2E, f));
  sh(`npm pack --pack-destination "${E2E}"`, ROOT);
  const tgz = readdirSync(E2E).find((f) => /^react-memory-leak-detector-.*\.tgz$/.test(f));
  if (!tgz) throw new Error("npm pack produced no tarball");

  console.log("→ Installing fixture deps + the packed detector…");
  sh("npm install", FIXTURE);
  sh(`npm install --no-save "${path.join(E2E, tgz)}"`, FIXTURE);

  console.log("→ Installing Playwright + Chromium…");
  sh("npm install", E2E);
  // Browser download is a fast no-op when the (version-matched) binary already
  // exists — e.g. baked into the Docker image.
  sh("npx playwright install chromium", E2E);
}

console.log(`\n→ Running ${combos.length} combo(s): ${combos.map((c) => `${c.PLUGIN_REACT}:${c.HEAP_ENGINE}`).join(", ")}\n`);

const failed = [];
for (const c of combos) {
  const label = `plugin-react ${c.PLUGIN_REACT} × engine ${c.HEAP_ENGINE}`;
  console.log(`\n════════ ${label} ════════`);
  try {
    sh("npx playwright test", E2E, { PLUGIN_REACT: c.PLUGIN_REACT, HEAP_ENGINE: c.HEAP_ENGINE });
  } catch {
    failed.push(label);
    console.error(`✗ FAILED: ${label}`);
  }
}

console.log("\n────────────────────────────");
if (failed.length) {
  console.error(`✗ ${failed.length}/${combos.length} combo(s) failed:\n  - ${failed.join("\n  - ")}`);
  process.exit(1);
}
console.log(`✓ all ${combos.length} combo(s) passed`);
