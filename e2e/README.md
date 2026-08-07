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
node e2e/run.mjs            # full matrix
node e2e/run.mjs v6:oxc     # one combo
SKIP_INSTALL=1 node e2e/run.mjs v5:babel   # reuse an already-prepared install
```

## Layout

```
e2e/
  fixture/            self-contained Vite + React app (leaky + fixed components)
  playwright/         the leak spec
  playwright.config.ts  launches Chromium with --expose-gc; boots the fixture dev server
  run.mjs             pack → install tarball → run the matrix
  Dockerfile          Node 22 + Playwright Chromium
  docker-compose.yml  bind-mounts the repo, keeps node_modules in named volumes
```

## Cleaning up

The harness keeps `node_modules` in **named Docker volumes** (`root_nm`, `e2e_nm`,
`fixture_nm`) and reuses the **built image** across runs so repeat runs are fast.
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
