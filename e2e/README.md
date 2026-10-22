# End-to-end pipeline

Proves the detector actually **catches a live leak** in a real app — the top of
the test pyramid, above the unit transform tests and the real-Vite integration
spec in `__tests__/`.

What it does, per run:

1. **Builds + packs** the detector workspaces (`npm pack` of `@memleak/core` +
   the framework adapter) and installs the **tarballs** into a self-contained
   fixture app (`e2e/fixture/`). Installing the packaged artifacts (not workspace
   symlinks) makes this a real packaging smoke test — it exercises each package's
   `exports` map, its `files` allowlist, and the dependency classification
   (including that `@memleak/react`'s `@memleak/core` dependency resolves from the
   co-installed tarball).
2. Boots the fixture's **real Vite dev server**.
3. Drives it in **headless Chromium** (Playwright), launched with
   `--js-flags=--expose-gc` so the runtime's `forceGc()` can collect
   deterministically.
4. Mounts then unmounts a **leaky** component and asserts the detector flags it
   (leak event **and** console warning); mounts/unmounts a **fixed** twin and
   asserts it stays silent and is garbage-collected. The fixed twin is the
   false-positive guard.

## The matrix

Every combo runs the same spec:

| `PLUGIN_REACT` | `HEAP_ENGINE` | exercises |
| -------------- | ------------- | --------- |
| `v5` | `oxc` | Babel-based React transform + detector's Oxc engine |
| `v5` | `babel` | Babel-based React transform + detector's Babel engine |
| `v6` | `oxc` | Oxc-based React transform (v6) + detector's Oxc engine |
| `v6` | `babel` | Oxc-based React transform (v6) + detector's Babel engine |

`@vitejs/plugin-react` v5 and v6 are both installed (as npm aliases
`plugin-react-v5` / `plugin-react-v6`); `vite.config.mjs` picks one via
`PLUGIN_REACT` and sets the detector's `engine` from `HEAP_ENGINE`.

A fifth combo, **`vue`**, runs the same spec against a Vite + Vue 3 fixture
(`e2e/fixture-vue/`) using the `@memleak/vue` plugin. Vue has no engine matrix (it rides
Oxc + `@vue/compiler-sfc` only). The Vue fixture mirrors the React one's
`data-testid`s and component names, so it reuses `playwright/leak.spec.ts`
unchanged; `run.mjs` selects it via `FRAMEWORK=vue FIXTURE=fixture-vue`.

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

Natively (needs Node ≥20.19 and a one-time `npx playwright install chromium`):

```bash
node e2e/run.mjs            # full matrix (React 2x2 + Vue)
node e2e/run.mjs v6:oxc     # one React combo
node e2e/run.mjs vue        # only the Vue leg
SKIP_INSTALL=1 node e2e/run.mjs v5:babel   # reuse an already-prepared install
```

## Layout

```
e2e/
  fixture/            self-contained Vite + React app (leaky + fixed components)
  fixture-vue/        self-contained Vite + Vue 3 app (same testids; reuses the spec)
  playwright/         the leak spec (framework-agnostic)
  playwright.config.ts  launches Chromium with --expose-gc; boots the fixture dev server
  run.mjs             pack workspaces → install tarballs → run the matrix
  Dockerfile          Node 22 + Playwright Chromium
  docker-compose.yml  bind-mounts the repo, keeps node_modules in named volumes
```

## Cleaning up

The harness keeps `node_modules` in **named Docker volumes** (`root_nm`, `e2e_nm`,
`fixture_nm`, `fixture_vue_nm`) and reuses the **built image** across runs so repeat runs are fast.
Both persist until you remove them. One command drops the named volumes **and**
the locally-built image:

```bash
cd e2e && docker compose down -v --rmi local
```

`docker compose run --rm` already removes the run container each time, so nothing
else lingers. If you ever run the matrix **natively** (not in Docker), it leaves
`e2e/node_modules`, `e2e/fixture/node_modules`, a packed `*.tgz`, and generated
`package-lock.json`s — all gitignored, removable with `git clean -Xdf e2e`.

## Why GC is deterministic here

`FinalizationRegistry` fires on GC, which is normally unpredictable. The fixture
sets `leakAgeMs: 0`, `warnCooldownMs: 0`, and an effectively-infinite
`sweepIntervalMs` (via `window.__heapTrackerOptions` in `index.html`), and the
spec calls `forceGc()` in cycles with a macrotask yield between each — a
`WeakRef` target can't be reclaimed in the same turn it was last observed. This
mirrors the recipe in `__tests__/real-leak.gc.ts`.

The **Vue** fixture additionally installs a no-op `window.__VUE_DEVTOOLS_GLOBAL_HOOK__`
in `index.html` before Vue boots. Without a connected devtools, Vue's dev build
holds every component instance in an internal replay buffer
(`__VUE_DEVTOOLS_HOOK_REPLAY__`) for ~3s; with `leakAgeMs: 0` the spec inspects a
just-unmounted "fixed" component inside that window, so Vue's own buffer — not a
leak — would keep it alive. The stub makes Vue drain and stop buffering (as a real
dev session with Vue Devtools open does). See the README "Vue coverage" note; apps
on the default `leakAgeMs` (10s) never hit this since the buffer clears first.
