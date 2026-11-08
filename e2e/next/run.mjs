// Next.js e2e matrix runner.
//
// 1. Build + pack the detector and install the TARBALL into one copy of the
//    fixture per Next.js major (`.work/<version>/`). `next` can't be installed
//    under npm aliases the way the Vite harness installs plugin-react v5/v6
//    (every `next/*` import must resolve to `next`), hence separate installs.
// 2. Per combo (Next version × bundler):
//      a. start `next dev` and log its output,
//      b. run the Playwright spec against it (next/playwright/next.spec.ts),
//      c. fail on any error in the dev-server log (e.g. the runtime failing to
//         load in Node shows up only there, not as an HTTP error),
//      d. run `next build` (must succeed, including its type check) and assert
//         no heap markers made it into the production output.
//
// Usage (from the repo root or anywhere):
//   node e2e/next/run.mjs                          # full matrix
//   node e2e/next/run.mjs next16:webpack next14:webpack
//   SKIP_INSTALL=1 node e2e/next/run.mjs next16:turbopack   # reuse installs
//   CHROMIUM_PATH=/path/to/chrome node e2e/next/run.mjs     # use a local browser

import { execSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NEXT_DIR = path.dirname(fileURLToPath(import.meta.url));
const E2E = path.resolve(NEXT_DIR, "..");
const ROOT = path.resolve(E2E, "..");
const FIXTURE = path.join(NEXT_DIR, "fixture");
const WORK = path.join(NEXT_DIR, ".work");
// Outside .work/ on purpose: in Docker, .work/ is a named volume, and CI
// uploads these logs from the bind-mounted repo on failure.
const LOGS = path.join(NEXT_DIR, "logs");
const PORT = Number(process.env.PORT) || 3100;

// Next.js majors under test, and how each differs from the README's defaults.
const VERSIONS = {
  next16: {
    deps: { next: "^16.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
    types: "^19",
    // Next 16's create-next-app tsconfig.
    moduleResolution: "bundler",
    // Runtime loaded from instrumentation-client.ts (Next 15.3+).
    runtimeVia: "instrumentation",
    turbopackRoot: true,
  },
  next15: {
    deps: { next: "^15.5.0", react: "^19.0.0", "react-dom": "^19.0.0" },
    types: "^19",
    moduleResolution: "bundler",
    runtimeVia: "instrumentation",
    turbopackRoot: true,
  },
  // The oldest Next with a top-level `turbopack` config key, i.e. the lower
  // bound of the wrapper's "use client" fallback. Pinned to 15.3.x so it
  // can't drift into the 15.5 range covered above.
  "next15.3": {
    deps: { next: "~15.3.0", react: "^19.0.0", "react-dom": "^19.0.0" },
    types: "^19",
    moduleResolution: "bundler",
    runtimeVia: "instrumentation",
    // No `turbopack.root` before 15.5 (Next would warn about an unknown key).
    turbopackRoot: false,
  },
  next14: {
    deps: { next: "^14.2.0", react: "^18.3.0", "react-dom": "^18.3.0" },
    types: "^18",
    // Next 13/14's create-next-app tsconfig ignores package `exports` maps,
    // which is what broke type checking of `react-memory-leak-detector/runtime`.
    moduleResolution: "node",
    // No instrumentation-client.ts before 15.3: the README's fallback is a
    // "use client" component rendered by the root layout.
    runtimeVia: "component",
  },
};

// `shared` = whether a component WITHOUT "use client" is instrumented when a
// Client Component renders it. True everywhere except Next 15's Turbopack,
// where the wrapper falls back to instrumenting "use client" files only.
const ALL = [
  { id: "next16:turbopack", version: "next16", dev: [], build: [], shared: true },
  { id: "next16:webpack", version: "next16", dev: ["--webpack"], build: ["--webpack"], shared: true },
  { id: "next15:turbopack", version: "next15", dev: ["--turbopack"], build: ["--turbopack"], shared: false },
  { id: "next15:webpack", version: "next15", dev: [], build: [], shared: true },
  { id: "next15.3:turbopack", version: "next15.3", dev: ["--turbopack"], build: ["--turbopack"], shared: false },
  { id: "next14:webpack", version: "next14", dev: [], build: [], shared: true },
];

const wanted = process.argv.slice(2);
const combos = wanted.length ? ALL.filter((c) => wanted.includes(c.id)) : ALL;
if (!combos.length) {
  console.error(`No combos matched ${JSON.stringify(wanted)}. Valid: ${ALL.map((c) => c.id).join(", ")}`);
  process.exit(2);
}

const sh = (cmd, cwd, env) =>
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });

// ── Setup ────────────────────────────────────────────────────────────────────

function tsconfig(moduleResolution) {
  return {
    compilerOptions: {
      target: "ES2017",
      lib: ["dom", "dom.iterable", "esnext"],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: "esnext",
      moduleResolution,
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: "preserve",
      incremental: true,
      plugins: [{ name: "next" }],
    },
    include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    exclude: ["node_modules"],
  };
}

/** Copies the fixture sources into `.work/<version>` (keeping node_modules). */
function syncFixture(version) {
  const spec = VERSIONS[version];
  const dir = path.join(WORK, version);
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(dir)) {
    if (entry !== "node_modules" && entry !== "package-lock.json") {
      rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
  }
  cpSync(FIXTURE, dir, { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: `heap-next-e2e-${version}`,
        private: true,
        dependencies: spec.deps,
        devDependencies: {
          typescript: "^5",
          "@types/node": "^20",
          "@types/react": spec.types,
          "@types/react-dom": spec.types,
        },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify(tsconfig(spec.moduleResolution), null, 2) + "\n",
  );
  return dir;
}

/**
 * next/font/local needs a real font file. Every Next version ships one inside
 * its own package (for @vercel/og), so use that instead of committing a binary.
 */
function copyFont(dir) {
  const ogDir = path.join(dir, "node_modules", "next", "dist", "compiled", "@vercel", "og");
  const ttf = existsSync(ogDir) && readdirSync(ogDir).find((f) => f.endsWith(".ttf"));
  if (!ttf) throw new Error(`no .ttf found in ${ogDir} to use for next/font/local`);
  mkdirSync(path.join(dir, "app", "fonts"), { recursive: true });
  cpSync(path.join(ogDir, ttf), path.join(dir, "app", "fonts", "TestFont.ttf"));
}

const versions = [...new Set(combos.map((c) => c.version))];
const dirs = Object.fromEntries(versions.map((v) => [v, syncFixture(v)]));

if (!process.env.SKIP_INSTALL) {
  console.log("→ Building + packing the detector…");
  sh("npm run build", ROOT);
  for (const f of readdirSync(WORK))
    if (/^react-memory-leak-detector-.*\.tgz$/.test(f)) rmSync(path.join(WORK, f));
  sh(`npm pack --pack-destination "${WORK}"`, ROOT);
  const tgz = readdirSync(WORK).find((f) => /^react-memory-leak-detector-.*\.tgz$/.test(f));
  if (!tgz) throw new Error("npm pack produced no tarball");

  for (const v of versions) {
    console.log(`→ Installing the ${v} fixture + the packed detector…`);
    sh("npm install --no-audit --no-fund", dirs[v]);
    sh(`npm install --no-save --no-audit --no-fund "${path.join(WORK, tgz)}"`, dirs[v]);
  }

  console.log("→ Installing Playwright…");
  sh("npm install --legacy-peer-deps", E2E);
  // A fast no-op when the browser is already there (e.g. the Docker image).
  if (!process.env.CHROMIUM_PATH) sh("npx playwright install chromium", E2E);
}
for (const v of versions) copyFont(dirs[v]);

// ── Per-combo steps ──────────────────────────────────────────────────────────

function startDevServer(combo, dir, logFile) {
  const out = [];
  const child = spawn("npx", ["next", "dev", "-p", String(PORT), ...combo.dev], {
    cwd: dir,
    env: envFor(combo),
    // Own process group, so the whole tree (npx → next → workers) can be killed.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const onData = (d) => {
    out.push(d);
    writeFileSync(logFile, Buffer.concat(out));
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const server = { dead: false };
  const exited = new Promise((resolve) => child.on("exit", resolve));
  exited.then(() => (server.dead = true));
  server.log = () => Buffer.concat(out).toString("utf8");
  // Stop the whole process group and wait until every process in it is gone:
  // `npx` exits before Next's workers, which keep writing to .next/ while they
  // shut down (removing .next/ then fails with ENOTEMPTY).
  server.stop = async () => {
    const signal = (sig) => {
      try {
        process.kill(-child.pid, sig);
        return true;
      } catch {
        return false; // ESRCH: the group is gone
      }
    };
    signal("SIGTERM");
    const deadline = Date.now() + 10_000;
    while (signal(0)) {
      if (Date.now() > deadline) {
        signal("SIGKILL");
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    await exited;
  };
  return server;
}

function envFor(combo) {
  return {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    HEAP_RUNTIME_VIA: VERSIONS[combo.version].runtimeVia,
    HEAP_TURBOPACK_ROOT: VERSIONS[combo.version].turbopackRoot ? "1" : "",
  };
}

/** Waits until the dev server answers, then compiles each route once. */
async function warmUp(server, routes) {
  const deadline = Date.now() + 180_000;
  for (const route of routes) {
    for (;;) {
      if (Date.now() > deadline) throw new Error(`dev server did not serve ${route} in time`);
      try {
        const res = await fetch(`http://localhost:${PORT}${route}`);
        await res.arrayBuffer();
        break; // Any response means it compiled (the spec checks the status).
      } catch {
        if (server.dead) throw new Error("dev server exited early");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
}

// Dev-server output that means something went wrong. `⨯` is how Next prefixes
// compile and runtime errors; unhandled rejections catch errors like the
// runtime failing to load in Node during SSR.
const DEV_LOG_ERRORS = /⨯|unhandledRejection|ERR_MODULE_NOT_FOUND|Module not found|Error:/;

function devLogErrors(log) {
  // Strip ANSI colors, then report the offending lines.
  return log
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .filter((line) => DEV_LOG_ERRORS.test(line));
}

// Production output is minified: `__heap_useRef` gets renamed and the
// `Foo$Heap` constructor name dropped, so those alone would miss a leak into the
// build. The injected `window.__heapTracker` property access survives
// minification, and a clean build never contains it (the runtime import is
// dead code in production).
const MARKERS = ["__heapTracker", "$Heap", "__heap_useRef"];

/** Files in the production output that still contain heap markers. */
function markersIn(dir) {
  const hits = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = path.join(d, entry);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (entry !== "cache") walk(p);
      } else if (/\.(js|mjs|cjs|html)$/.test(entry)) {
        const text = readFileSync(p, "utf8");
        if (MARKERS.some((m) => text.includes(m))) hits.push(path.relative(dir, p));
      }
    }
  };
  walk(path.join(dir, ".next"));
  return hits;
}

// Retries cover a straggling file handle on slow filesystems (e.g. Docker
// bind mounts on macOS).
const RM_NEXT = { recursive: true, force: true, maxRetries: 5, retryDelay: 500 };

/** True if something already answers on PORT (e.g. a stray dev server). */
async function portInUse() {
  try {
    await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

async function runCombo(combo) {
  // Otherwise `next dev` would exit with EADDRINUSE while the spec silently
  // tests whatever else is listening.
  if (await portInUse()) return `port ${PORT} is already in use (set PORT to use another)`;

  const dir = dirs[combo.version];
  const tag = combo.id.replace(":", "-");
  mkdirSync(LOGS, { recursive: true });
  rmSync(path.join(dir, ".next"), RM_NEXT);

  // a) dev server
  const devLog = path.join(LOGS, `${tag}-dev.log`);
  const server = startDevServer(combo, dir, devLog);
  let failure = null;
  try {
    await warmUp(server, ["/", "/legacy"]);

    // b) browser spec
    try {
      sh("npx playwright test -c next/playwright.config.ts", E2E, {
        BASE_URL: `http://localhost:${PORT}`,
        NEXT_COMBO: combo.id,
        NEXT_SHARED_INSTRUMENTED: combo.shared ? "1" : "0",
      });
    } catch {
      failure = "browser spec failed";
    }
  } catch (err) {
    failure = err.message;
  } finally {
    await server.stop();
  }

  // c) dev-server log
  const errors = devLogErrors(server.log());
  if (errors.length) {
    console.error(`Dev-server errors (full log: ${devLog}):\n  ${errors.slice(0, 20).join("\n  ")}`);
    failure = failure || "errors in the dev-server log";
  }
  if (failure) return failure;

  // d) production build: must compile + type-check, and ship no markers.
  rmSync(path.join(dir, ".next"), RM_NEXT);
  console.log(`→ next build ${combo.build.join(" ")}`.trim());
  try {
    sh(`npx next build ${combo.build.join(" ")}`, dir, envFor(combo));
  } catch {
    return "next build failed";
  }
  const hits = markersIn(dir);
  if (hits.length) {
    console.error(`Heap markers in the production build:\n  ${hits.join("\n  ")}`);
    return "heap markers in the production build";
  }
  console.log("✓ production build is clean (no heap markers)");
  return null;
}

console.log(`\n→ Running ${combos.length} combo(s): ${combos.map((c) => c.id).join(", ")}\n`);
const failed = [];
for (const combo of combos) {
  console.log(`\n════════ ${combo.id} ════════`);
  const failure = await runCombo(combo);
  if (failure) {
    failed.push(`${combo.id}: ${failure}`);
    console.error(`✗ FAILED: ${combo.id} (${failure})`);
  } else {
    console.log(`✓ ${combo.id}`);
  }
}

console.log("\n────────────────────────────");
if (failed.length) {
  console.error(`✗ ${failed.length}/${combos.length} combo(s) failed:\n  - ${failed.join("\n  - ")}`);
  process.exit(1);
}
console.log(`✓ all ${combos.length} combo(s) passed`);
