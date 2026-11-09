// E2E matrix runner.
//
// 1. Build + pack the detector, then install the TARBALL into the fixture app
//    (a real packaging smoke test — exercises the exports map, `files`, and the
//    dependency classification, which unit tests can't).
// 2. Install the Playwright harness + Chromium.
// 3. Run the leak suite once per combo of:
//       @vitejs/plugin-react  v5 (Babel) | v6 (Oxc)
//       detector engine        oxc | babel
//       React                  17 | 18 (the fixture's own dependency) | 19
//    plus React 19 with the React Compiler (plugin-react v5's `babel` option;
//    v6 has no such option). Each combo boots a fresh Vite dev server (via
//    Playwright's webServer) with the right env and drives a real headless
//    browser to prove live detection.
//
// Usage:
//   node run.mjs                 # full matrix
//   node run.mjs v6:oxc v5:babel:react17 v5:oxc:react19-compiler
//                                # only the listed combos
//   SKIP_INSTALL=1 node run.mjs  # reuse an already-prepared fixture/e2e install
//   CHROMIUM_PATH=/path/to/chrome node run.mjs   # use a local browser

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const E2E = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(E2E, "..");
const FIXTURE = path.join(E2E, "fixture");

const sh = (cmd, cwd, env) =>
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });

// REACT: major installed into the fixture for the combo. COMPILER: run
// babel-plugin-react-compiler (plugin-react v5 only; see vite.config.mjs).
const ALL = [];
for (const REACT of ["17", "18", "19"])
  for (const PLUGIN_REACT of ["v5", "v6"])
    for (const HEAP_ENGINE of ["oxc", "babel"]) ALL.push({ PLUGIN_REACT, HEAP_ENGINE, REACT, COMPILER: "" });
for (const HEAP_ENGINE of ["oxc", "babel"])
  ALL.push({ PLUGIN_REACT: "v5", HEAP_ENGINE, REACT: "19", COMPILER: "1" });

// "v6:oxc" on React 18 (the fixture default), "v6:oxc:react17",
// "v6:oxc:react19", "v5:oxc:react19-compiler".
const idOf = (c) =>
  `${c.PLUGIN_REACT}:${c.HEAP_ENGINE}` +
  (c.REACT === "18" ? "" : `:react${c.REACT}`) +
  (c.COMPILER ? "-compiler" : "");

// Optional combo filter from argv, e.g. "v6:oxc".
const wanted = process.argv.slice(2);
const combos = wanted.length
  ? ALL.filter((c) => wanted.includes(idOf(c)))
  : ALL;
if (!combos.length) {
  console.error(`No combos matched ${JSON.stringify(wanted)}. Valid: ${ALL.map(idOf).join(", ")}`);
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
  sh("npm install --legacy-peer-deps", FIXTURE);
  sh(`npm install --no-save --legacy-peer-deps "${path.join(E2E, tgz)}"`, FIXTURE);

  console.log("→ Installing Playwright + Chromium…");
  sh("npm install --legacy-peer-deps", E2E);
  // Browser download is a fast no-op when the (version-matched) binary already
  // exists — e.g. baked into the Docker image.
  if (!process.env.CHROMIUM_PATH) sh("npx playwright install chromium", E2E);
}

// Switches the fixture's React between combos. The packed detector was
// installed with --no-save, and a later `npm install --no-save <pkg>` prunes
// it as extraneous, so it is reinstalled in the same command.
function installedReact() {
  try {
    const pkg = path.join(FIXTURE, "node_modules", "react", "package.json");
    return JSON.parse(readFileSync(pkg, "utf8")).version.split(".")[0];
  } catch {
    return null;
  }
}
function useReact(major) {
  if (installedReact() === major) return;
  const tgz = readdirSync(E2E).find((f) => /^react-memory-leak-detector-.*\.tgz$/.test(f));
  if (!tgz) throw new Error("no packed detector in e2e/; run without SKIP_INSTALL first");
  console.log(`→ Installing React ${major} into the fixture…`);
  sh(
    `npm install --no-save --legacy-peer-deps react@^${major} react-dom@^${major} "${path.join(E2E, tgz)}"`,
    FIXTURE,
  );
}

console.log(`\n→ Running ${combos.length} combo(s): ${combos.map(idOf).join(", ")}\n`);

const failed = [];
try {
  for (const c of combos) {
    const label =
      `plugin-react ${c.PLUGIN_REACT} × engine ${c.HEAP_ENGINE} × React ${c.REACT}` +
      (c.COMPILER ? " + React Compiler" : "");
    console.log(`\n════════ ${label} ════════`);
    useReact(c.REACT);
    try {
      sh("npx playwright test", E2E, {
        PLUGIN_REACT: c.PLUGIN_REACT,
        HEAP_ENGINE: c.HEAP_ENGINE,
        REACT: c.REACT,
        COMPILER: c.COMPILER,
      });
    } catch {
      failed.push(label);
      console.error(`✗ FAILED: ${label}`);
    }
  }
} finally {
  // Leave the fixture on its own React, so SKIP_INSTALL runs start from it.
  useReact("18");
}

console.log("\n────────────────────────────");
if (failed.length) {
  console.error(`✗ ${failed.length}/${combos.length} combo(s) failed:\n  - ${failed.join("\n  - ")}`);
  process.exit(1);
}
console.log(`✓ all ${combos.length} combo(s) passed`);
