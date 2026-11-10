# End-to-end pipeline

Proves the detector actually **catches a live leak** in a real app — the top of
the test pyramid, above the unit transform tests and the real-Vite integration
spec in `__tests__/`.

What it does, per run:

1. **Builds + packs** the detector (`npm pack`) and installs the **tarball** into
   a self-contained fixture app (`e2e/fixture/`). Installing the packaged artifact
   (not a symlink) makes this a real packaging smoke test — it exercises the
   `exports` map, the `files` allowlist, and the dependency classification.
2. Boots the fixture's **real Vite dev server**.
3. Drives it in **headless Chromium** (Playwright), launched with
   `--js-flags=--expose-gc` so the runtime's `forceGc()` can collect
   deterministically.
4. Mounts then unmounts a **leaky** component and asserts the detector flags it
   (leak event **and** console warning); mounts/unmounts a **fixed** twin and
   asserts it stays silent and is garbage-collected. The fixed twin is the
   false-positive guard.
5. **One DevTools click is enough**: mounts and unmounts a leaky component ten
   times, each unmount in a task of its own, then runs DevTools' "Collect
   garbage" once (over the DevTools protocol) and asserts all ten instances
   are reported.
6. Loads a second entry, **`/late.html`**, that installs the runtime with the
   README's fire-and-forget `import()` (so it arrives *after* the first render)
   and mounts a leaky and a fixed component in the initial tree. Asserts the
   runtime adopts the leaky one and still flags it after unmount. For the fixed
   one, it forces minor GCs (`gc({ type: "minor" })`) around its unmount and
   asserts they alone never get it reported: only a major collection counts
   as evidence (see `src/witness.ts`).
7. **Collections around an unmount** (`playwright/gc-during-unmount.spec.ts`,
   with `--expose-gc`, `leakAgeMs: 0`): forces minor, major, or both
   collections synchronously inside the unmount, in a microtask after it, and
   in the next task. It then sweeps without any further collection, and no
   fixed component may be reported. A cleaned-up component survives minor
   collections in Chrome (dead DOM-side records still point at it), so a
   minor collection must never count as evidence.
8. **Garbage-collection lag** (`playwright/gc-lag.spec.ts`, Playwright project
   `chromium-no-gc`): the way users run it, with Chromium launched *without*
   `--expose-gc` and the runtime on its default options (`/defaults.html`).
   Mounts and unmounts the four fixed components and a leaky one, waits past
   `leakAgeMs`, and asserts no fixed component was reported; then clicks
   DevTools' "Collect garbage" (over the DevTools protocol) and asserts the
   fixed components are gone and the leak is reported. If the browser already
   freed the fixed components on its own before the check, the run can't show
   anything and the test skips itself as inconclusive. (Before the runtime
   waited for a collection, this was an expected failure: every conclusive
   run reported the fixed components.)

## The matrix

Every combo runs all three specs:

| `PLUGIN_REACT` | `HEAP_ENGINE` | exercises |
| -------------- | ------------- | --------- |
| `v5` | `oxc` | Babel-based React transform + detector's Oxc engine |
| `v5` | `babel` | Babel-based React transform + detector's Babel engine |
| `v6` | `oxc` | Oxc-based React transform (v6) + detector's Oxc engine |
| `v6` | `babel` | Oxc-based React transform (v6) + detector's Babel engine |

Each of the four runs on React 17 (`v5:oxc:react17` …), React 18 (the
fixture's own dependency, `v5:oxc` …) and React 19 (`v5:oxc:react19` …). Two
more run React 19 with the React Compiler, through plugin-react v5's `babel`
option (v6 has none): `v5:oxc:react19-compiler` and
`v5:babel:react19-compiler`. That's 14 combos. `run.mjs` swaps React in the
fixture between combos and restores React 18 at the end. React 17 has no
`react-dom/client`, so the entries mount through `src/mount.tsx`
(`createRoot`), which `vite.config.mjs` swaps for `src/mount-legacy.tsx`
(`ReactDOM.render`) when the installed React is 17. The
first spec test checks that the page really runs the expected React and, with
the compiler, that the served component modules really are compiled (the
compiler skips a function silently when it can't compile it).

`@vitejs/plugin-react` v5 and v6 are both installed (as npm aliases
`plugin-react-v5` / `plugin-react-v6`); `vite.config.mjs` picks one via
`PLUGIN_REACT` and sets the detector's `engine` from `HEAP_ENGINE`.

> v6.0.5 requires **Vite ^8**, so the fixture pins Vite 8 (v5 supports it too).
> `oxc-parser` and Vite 8 require **Node ^20.19 || >=22.12** — the Docker image
> uses Node 22.

## Run it

In Docker (mounts the repo, as the CI does):

```bash
cd e2e && docker compose run --build --rm e2e
```

A single combo:

```bash
cd e2e && docker compose run --build --rm e2e sh -c "npm ci && node e2e/run.mjs v6:oxc"
```

Natively (needs Node ≥20.19 and a one-time `npx playwright install chromium`,
or point `CHROMIUM_PATH` at a local Chromium):

```bash
node e2e/run.mjs            # full matrix
node e2e/run.mjs v6:oxc     # one combo
node e2e/run.mjs v5:oxc:react17            # React 17 (legacy root)
node e2e/run.mjs v5:oxc:react19-compiler   # React 19 + React Compiler
SKIP_INSTALL=1 node e2e/run.mjs v5:babel   # reuse an already-prepared install
```

## Next.js matrix

`e2e/next/` runs the same idea against **real Next.js apps** using the
`react-memory-leak-detector/next` wrapper. A single fixture (`next/fixture/`) is
copied into `next/.work/<version>/` and installed once per Next version, because
`next` can't be installed side by side under npm aliases.

| Combo | Bundler | Notes |
| ----- | ------- | ----- |
| `next16:turbopack` | Turbopack | `next dev` default on 16 |
| `next16:webpack` | webpack | `next dev --webpack` |
| `next15:turbopack` | Turbopack | `"use client"`-only fallback (15.x ignores the `browser` rule condition) |
| `next15:webpack` | webpack | `next dev` default on 15 |
| `next15.3:turbopack` | Turbopack | Oldest supported Turbopack (pinned to 15.3.x); same fallback, and only the loader's own check keeps production builds clean |
| `next14:webpack` | webpack | React 18, `moduleResolution: "node"` tsconfig, runtime loaded from a `"use client"` component |

Per combo, `next/run.mjs`:

1. Starts `next dev` itself and logs its output to `next/logs/`.
2. Runs `next/playwright/next.spec.ts` in headless Chromium (`--expose-gc`):
   - **App Router:** a Server Component that imports from `react` renders (it
     must not be instrumented), the `withHeapMarkers()` options reach the
     runtime, `LeakyTimer` is flagged (event and console warning), and
     `FixedTimer` is garbage-collected without being flagged.
   - **Shared component:** `Label` has no directive and renders as both a
     Server and a Client Component. It must be instrumented in the browser,
     except on Next 15's Turbopack fallback (15.3 and 15.5), where it must not be.
   - **Pages Router (`/legacy`):** the runtime loaded from `_app` flags the leak.
   - No page errors or `console.error` output (e.g. hydration mismatches).
3. Fails if the dev-server log contains errors. Some regressions only show up
   there: when the runtime can't be loaded by Node during SSR, every page still
   returns 200.
4. Runs `next build` for the same bundler. It must succeed (including Next's
   type check) and the output must contain no heap markers.

The fixture uses `next/font/local` (SWC-only under webpack) with a font file
copied from the installed `next` package, so the suite needs no network access
beyond npm.

Run it:

```bash
cd e2e && docker compose run --build --rm e2e sh -c "npm ci && node e2e/next/run.mjs"
cd e2e && docker compose run --build --rm e2e sh -c "npm ci && node e2e/next/run.mjs next16:webpack"
```

Natively (needs Node ≥20.19 and `npx playwright install chromium`, or point
`CHROMIUM_PATH` at a local Chromium):

```bash
node e2e/next/run.mjs                       # full matrix
node e2e/next/run.mjs next14:webpack        # one combo
SKIP_INSTALL=1 node e2e/next/run.mjs next16:turbopack   # reuse the installs
```

`SKIP_INSTALL=1` reuses the installed tarball. Rebuild it (drop the flag) after
changing the detector itself; fixture edits are picked up either way.

## Layout

```
e2e/
  fixture/            self-contained Vite + React app (leaky + fixed components)
    index.html        runtime imported statically (src/main.tsx)
    late.html         runtime loaded via the README's dynamic import() (src/late.tsx)
    defaults.html     as index.html, but with the runtime's default options
    src/mount.tsx     mounts the app (createRoot); mount-legacy.tsx for React 17
  playwright/         leak.spec.ts + gc-during-unmount.spec.ts (with --expose-gc), gc-lag.spec.ts (without)
  playwright.config.ts  two Chromium projects (with / without --expose-gc); boots the fixture dev server
  run.mjs             pack → install tarball → run the matrix
  next/
    fixture/          Next.js app (App + Pages Router) shared by every Next version
    playwright/       the Next.js spec
    playwright.config.ts  no webServer: run.mjs starts `next dev` and reads its log
    run.mjs           pack → install per Next version → dev + spec + log check + build
  Dockerfile          Node 22 + Playwright Chromium
  docker-compose.yml  bind-mounts the repo, keeps node_modules in named volumes
```

## Cleaning up

The harness keeps `node_modules` in **named Docker volumes** (`root_nm`, `e2e_nm`,
`fixture_nm`, and `next_work` for the Next.js installs) and reuses the **built image** across runs so repeat runs are fast.
Both persist until you remove them. One command drops the named volumes **and**
the locally-built image:

```bash
cd e2e && docker compose down -v --rmi local
```

`docker compose run --rm` already removes the run container each time, so nothing
else lingers. If you ever run the matrix **natively** (not in Docker), it leaves
`e2e/node_modules`, `e2e/fixture/node_modules`, a packed `*.tgz`, and generated
`package-lock.json`s — all gitignored, removable with `git clean -Xdf e2e`. The
Next.js matrix adds `e2e/next/.work/` and `e2e/next/logs/`, also gitignored.

## Why GC is deterministic here

`FinalizationRegistry` fires on GC, which is normally unpredictable. The fixture
sets `leakAgeMs: 0`, `warnCooldownMs: 0`, and an effectively-infinite
`sweepIntervalMs` (via `window.__heapTrackerOptions` in `index.html`), and the
spec calls `forceGc()` in cycles with a macrotask yield between each — a
`WeakRef` target can't be reclaimed in the same turn it was last observed. This
mirrors the recipe in `__tests__/real-leak.gc.ts`. The runtime reports an
instance only after a collection that ran once it was stale; with `leakAgeMs: 0`
that is any collection after unmount (a component adopted on unmount needs a
few), which the cycles provide.
