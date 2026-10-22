// E2E matrix runner.
//
// 1. Build + pack the detector workspaces (@memleak/core + the framework
//    adapters), then install the TARBALLS into the fixture apps (a real
//    packaging smoke test — exercises each package's exports map, `files`, and
//    dependency classification, which unit tests can't).
// 2. Install the Playwright harness + Chromium.
// 3. Run the leak suite once per combo:
//       React leg:  @vitejs/plugin-react v5 (Babel) | v6 (Oxc)
//                   detector engine        oxc | babel
//       Vue leg:    Vue 3 <script setup>, detector engine oxc (no matrix)
//    Each combo boots a fresh Vite dev server (via Playwright's webServer) with
//    the right env and drives a real headless browser to prove live detection.
//
// Usage:
//   node run.mjs                        # full matrix (React 2x2 + Vue)
//   node run.mjs v6:oxc v5:babel        # only the listed React combos
//   node run.mjs vue                    # only the Vue leg
//   SKIP_INSTALL=1 node run.mjs         # reuse an already-prepared install

import { execSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const E2E = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(E2E, "..");
const FIXTURE = path.join(E2E, "fixture");
const FIXTURE_VUE = path.join(E2E, "fixture-vue");

// The monorepo packs one tarball per workspace package; a fixture installs the
// ones it needs (always @memleak/core + its framework adapter). npm names a
// scoped-package tarball `@memleak/react` → `memleak-react-<version>.tgz`.
const WORKSPACES = ["@memleak/core", "@memleak/react", "@memleak/vue"];
const TGZ_RE = /^memleak-(core|react|vue)-.*\.tgz$/;
const tgzPathFor = (pkg) => {
  const base = pkg.replace("@memleak/", "memleak-");
  const file = readdirSync(E2E).find(
    (f) => f.startsWith(base + "-") && f.endsWith(".tgz"),
  );
  if (!file) throw new Error(`npm pack produced no tarball for ${pkg}`);
  return path.join(E2E, file);
};

const sh = (cmd, cwd, env) =>
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });

// Combo model: React combos carry {framework:'react', PLUGIN_REACT, HEAP_ENGINE};
// the Vue combo is just {framework:'vue'}. `key` is the argv selector.
const ALL = [];
for (const PLUGIN_REACT of ["v5", "v6"])
  for (const HEAP_ENGINE of ["oxc", "babel"])
    ALL.push({
      framework: "react",
      PLUGIN_REACT,
      HEAP_ENGINE,
      key: `${PLUGIN_REACT}:${HEAP_ENGINE}`,
    });
ALL.push({ framework: "vue", key: "vue" });

// Optional combo filter from argv, e.g. "v6:oxc" or "vue".
const wanted = process.argv.slice(2);
const combos = wanted.length ? ALL.filter((c) => wanted.includes(c.key)) : ALL;
if (!combos.length) {
  console.error(
    `No combos matched ${JSON.stringify(wanted)}. Valid: ${ALL.map((c) => c.key).join(", ")}`,
  );
  process.exit(2);
}

const needReact = combos.some((c) => c.framework === "react");
const needVue = combos.some((c) => c.framework === "vue");

if (!process.env.SKIP_INSTALL) {
  console.log("→ Building + packing the detector workspaces…");
  // Root build fans out to the workspaces; only @memleak/core compiles TS, and
  // its dist/ must exist before pack so the core tarball ships the runtime.
  sh("npm run build", ROOT);
  // Clean any stale tarballs so the lookups below are unambiguous.
  for (const f of readdirSync(E2E)) if (TGZ_RE.test(f)) rmSync(path.join(E2E, f));
  sh(
    `npm pack ${WORKSPACES.map((w) => `-w ${w}`).join(" ")} --pack-destination "${E2E}"`,
    ROOT,
  );
  const coreTgz = tgzPathFor("@memleak/core");

  if (needReact) {
    console.log("→ Installing React fixture deps + the packed detector…");
    sh("npm install --legacy-peer-deps", FIXTURE);
    // Install core + react in one command so @memleak/react's `@memleak/core`
    // dependency resolves to the local tarball (the scope isn't published yet).
    sh(
      `npm install --no-save --legacy-peer-deps "${coreTgz}" "${tgzPathFor("@memleak/react")}"`,
      FIXTURE,
    );
  }

  if (needVue) {
    console.log("→ Installing Vue fixture deps + the packed detector…");
    sh("npm install --legacy-peer-deps", FIXTURE_VUE);
    sh(
      `npm install --no-save --legacy-peer-deps "${coreTgz}" "${tgzPathFor("@memleak/vue")}"`,
      FIXTURE_VUE,
    );
  }

  console.log("→ Installing Playwright + Chromium…");
  sh("npm install --legacy-peer-deps", E2E);
  // Browser download is a fast no-op when the (version-matched) binary already
  // exists — e.g. baked into the Docker image.
  sh("npx playwright install chromium", E2E);
}

console.log(
  `\n→ Running ${combos.length} combo(s): ${combos.map((c) => c.key).join(", ")}\n`,
);

const failed = [];
for (const c of combos) {
  const label =
    c.framework === "vue"
      ? "vue × engine oxc"
      : `plugin-react ${c.PLUGIN_REACT} × engine ${c.HEAP_ENGINE}`;
  console.log(`\n════════ ${label} ════════`);
  const env =
    c.framework === "vue"
      ? { FRAMEWORK: "vue", FIXTURE: "fixture-vue" }
      : {
          FRAMEWORK: "react",
          FIXTURE: "fixture",
          PLUGIN_REACT: c.PLUGIN_REACT,
          HEAP_ENGINE: c.HEAP_ENGINE,
        };
  try {
    sh("npx playwright test", E2E, env);
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
