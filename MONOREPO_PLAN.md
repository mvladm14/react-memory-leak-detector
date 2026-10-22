# Restructure into the `memleak` monorepo (npm workspaces)

> **This is a hand-off plan for a future session.** It is intended to be implemented in a separate session, then **deleted once implemented** (`rm MONOREPO_PLAN.md`). It is not itself part of the shipped project.

## Context

The package currently ships as a single `@mvladm14/memory-leak-detector` that already supports both React and Vue and is internally shaped as "shared core + per-framework engines". The goal is to detect memory leaks across **all major FE frameworks** (React, Vue today; Angular, Svelte next). To make that sustainable, we're restructuring the single package into a **monorepo** under the chosen brand **`memleak`**, using **npm workspaces** (no new tooling — keeps the existing npm lockfile and the Docker e2e pipeline intact).

**Repo strategy (decided):** restructure **this repo in place** — do not start a new repo. Renaming the GitHub repo `react-memory-leak-detector` → `memleak` is deferred to a later session (GitHub auto-redirects the old URL when it happens). Keeping this repo preserves git history, CI, and the e2e Docker pipeline; the existing code is the monorepo seed.

**Scope of this change:** restructure only. **Do NOT publish anything** and **do NOT claim the npm org / rename the GitHub repo** — those are deferred to a later session. All package names use the `@memleak/*` scope so the tree is publish-ready when the user chooses, but everything stays `"private"` for now and resolves via workspace symlinks. The old-package deprecation + shim (see below) is designed here but **published later**.

## Decisions (confirmed with user)

- Brand: **`memleak`** → scope `@memleak/*` (verified available on npm; not claiming yet).
- Tooling: **npm workspaces** (add Turborepo later only if builds grow).
- Repo: **continue in this repo**; rename to `memleak` deferred.
- Migration: **deprecate + shim** the old package (designed here, published later).
- **No publishing** in this pass; root + all packages marked `"private": true` for now.
- No separate `@memleak/vite` package — `./vite` today is just an alias of `./react`, so each framework adapter owns its own Vite plugin.

## Target structure

```
memleak/                        (repo root — private, workspaces host)
  package.json                  "private": true, "workspaces": ["packages/*"]
  tsconfig.base.json            shared compiler options
  jest.config.js                root runner across workspaces (projects)
  packages/
    core/                       @memleak/core
      package.json
      tsconfig.json             extends base; rootDir src → outDir dist
      src/                      ← from repo src/ (runtime: config, lifecycle, runtime, store, subscribers, sweep, types)
      dist/                     build output (gitignored)
      lib/                      ← from repo lib/core/ (walk.js, inject.js, config-source.js, predicates.js)
    react/                      @memleak/react   (depends on @memleak/core)
      package.json
      src/                      ← babel-plugin.js, engine-oxc.js, engine-babel.js, vite.js
      types/                    ← vite.d.ts, babel-plugin.d.ts
    vue/                        @memleak/vue     (depends on @memleak/core)
      package.json
      src/                      ← engine-vue.js, vue.js
      types/                    ← vue.d.ts
  e2e/                          existing harness (fixture, fixture-vue, playwright, docker)
  __tests__/                    unit + gc suites (stay at root or split per-package — see Testing)
  README.md  CHANGELOG.md  LICENSE
```

## Package-by-package mapping

### `@memleak/core`
Holds everything both adapters share.

- **Runtime** (TS, compiled): move `src/*.ts` → `packages/core/src/`. Build with `tsc` to `packages/core/dist/`. Export as `@memleak/core/runtime` (points at `dist/runtime.js`) — this is the `./runtime` export consumers import once at app boot.
- **Build-time AST core** (CommonJS): move `lib/core/{walk,inject,config-source,predicates}.js` → `packages/core/lib/`. Internal `require("./walk")` in [lib/core/inject.js](lib/core/inject.js) stays relative — unchanged.
- `lib/predicates.js` (the React-flavored wrapper that re-exports `./core/predicates` and adds `isReactFile`/`isPascalCase`/`isCustomHook`) → keep in core as `packages/core/lib/predicates.js` (both engines consume it). Its `require("./core/predicates")` becomes `require("./predicates-core")` or the file is merged — resolve during move; keep the split minimal.
- `package.json` exports: `{"./runtime": "./dist/runtime.js", "./ast": "./lib/index.js"}` (or expose `./walk`, `./inject`, etc. individually). Add a small `lib/index.js` barrel re-exporting walk/inject/config-source/predicates so adapters import from one place.

### `@memleak/react`
- Move `babel-plugin.js`, `lib/engine-oxc.js`, `lib/engine-babel.js`, `vite.js` → `packages/react/src/`.
- Rewrite internal requires to the new core package:
  - [lib/engine-oxc.js](lib/engine-oxc.js): `./predicates` → `@memleak/core` (ast barrel), `./core/walk` → `@memleak/core`, `./core/inject`, `./core/config-source` likewise.
  - [lib/engine-babel.js](lib/engine-babel.js): `../babel-plugin` → `./babel-plugin` (same package); `@babel/core` unchanged (optional peer).
  - [babel-plugin.js](babel-plugin.js): `./lib/predicates` → `@memleak/core`.
  - [vite.js](vite.js): `./lib/engine-babel` → `./engine-babel`, `./lib/engine-oxc` → `./engine-oxc`.
- Move `vite.d.ts`, `babel-plugin.d.ts` → `packages/react/types/`.
- `package.json`: `dependencies: {"@memleak/core": "*"}`; optional peers `react`, `vite`, `@babel/core`; optionalDeps `oxc-parser`, `magic-string`. Exports `{".": .../vite.js, "./babel-plugin": ...}`. Update the docs/banner strings that say `react-memory-leak-detector` / import path in [vite.js](vite.js) header comment.

### `@memleak/vue`
- Move `lib/engine-vue.js`, `vue.js` → `packages/vue/src/`.
- Rewrite requires in [lib/engine-vue.js](lib/engine-vue.js): `./core/walk`, `./core/inject`, `./core/config-source`, `./core/predicates` → `@memleak/core`. In [vue.js](vue.js): `./lib/engine-vue` → `./engine-vue`.
- Move `vue.d.ts` → `packages/vue/types/`.
- `package.json`: `dependencies: {"@memleak/core": "*"}`; optional peers `vue`, `@vue/compiler-sfc`, `vite`; optionalDeps `oxc-parser`, `magic-string`. Update the `memory-leak-detector/vue` and `/runtime` import strings in the [vue.js](vue.js) header to `@memleak/vue` / `@memleak/core/runtime`.

## Root workspace config

- Root `package.json`: `"private": true`, `"workspaces": ["packages/*"]`, top-level scripts that fan out (`"build": "npm run build --workspaces --if-present"`, `"test": "jest"`, `"typecheck": "tsc -b"` or per-workspace).
- `tsconfig.base.json` with the shared options from current [tsconfig.json](tsconfig.json) (target ES2021, strict, declaration). Each package `tsconfig.json` extends it and sets its own `rootDir`/`outDir`. Only `@memleak/core` compiles TS today (the adapters are plain `.js` + hand-written `.d.ts`).
- `.gitignore`: ensure `packages/*/dist` ignored.

## Testing

- Current [jest.config.js](jest.config.js) has two projects (`unit` via ts-jest, `gc` via babel-jest) and hard-codes `babel-plugin.js` + `__tests__`. Update the `gc` project's plugin path to `packages/react/src/babel-plugin.js`. Keep a single root `jest.config.js` running across the repo (simplest; workspaces don't need per-package jest yet).
- The untracked `__tests__/engine-vue.test.js` and the existing suites keep working once import paths resolve to the moved files / `@memleak/*` symlinks.
- `__tests__/gc-setup.ts` and gc fixtures import the runtime — point them at `@memleak/core/runtime` (or the built `dist`).

## E2E

- `e2e/fixture/` (React) and `e2e/fixture-vue/` (Vue) currently import `@mvladm14/memory-leak-detector/{react,vue,runtime}`. Update imports to `@memleak/react`, `@memleak/vue`, `@memleak/core/runtime`.
- `e2e/` installs the package under test — with workspaces it resolves locally; confirm [e2e/run.mjs](e2e/run.mjs), [e2e/docker-compose.yml](e2e/docker-compose.yml), and the fixtures' `vite.config.mjs` reference the new package names and local workspace paths (`file:../../packages/*`) rather than the old single package.
- The v5/v6 × oxc/babel matrix (per the e2e pipeline) must still pass — that's the acceptance gate.

## Migration steps (ordered)

1. Create `packages/{core,react,vue}` dirs and the root workspace `package.json` + `tsconfig.base.json`.
2. Move runtime `src/` and build-time `lib/core/*` (+ `lib/predicates.js`) into `packages/core/`; add core `package.json`, `tsconfig.json`, and `lib/index.js` barrel.
3. Move React files into `packages/react/`; rewrite requires to `@memleak/core`; add its `package.json`.
4. Move Vue files into `packages/vue/`; rewrite requires; add its `package.json`.
5. `npm install` at root to wire workspace symlinks; `npm run build` (compiles core).
6. Update `jest.config.js` paths; run `npm test`.
7. Update `e2e/` fixtures + configs to `@memleak/*`; run the e2e matrix.
8. Update `README.md`, `CHANGELOG.md`, and in-file header docs/banner strings to the new names.

## Verification

- `npm install` at root resolves all three workspaces via symlink (check `node_modules/@memleak/*`).
- `npm run build` compiles `@memleak/core` to `dist/` with no TS errors (`tsc`).
- `npm test` — both `unit` and `gc` Jest projects green (the `gc` project must instrument via the moved `packages/react/src/babel-plugin.js` and detect a real GC leak).
- `npm run typecheck` (existing `type-tests/entries.ts`) passes against the new export paths.
- E2E: run the Docker matrix (v5/v6 × oxc/babel) for React and the Vue fixture; live leak warnings must fire in headless Chromium exactly as before.
- Grep the repo for `@mvladm14`, `react-memory-leak-detector`, and stale relative requires (`./lib/`, `./core/`) to confirm nothing dangles.

## Migration & deprecation (designed now, published later)

Existing users install the old package (identity to confirm — see note below). To migrate them without breakage:

- **Deprecate**: once the new packages are published, run `npm deprecate <old-package>@"*" "Moved to @memleak/react — see migration guide"`.
- **Shim**: publish one final version of the old package as a thin re-export of `@memleak/react` (its Vite plugin as the default export, plus `./babel-plugin`, `./runtime` re-exporting `@memleak/core/runtime`), emitting a one-time console warning to switch. This keeps existing `import x from "memory-leak-detector/react"` working during migration.
- Authored in this pass under `packages/legacy-shim/` (name = the old package, `"private": true` for now) so it's ready to publish later; kept out of the active workspace build path to avoid confusion.
- **Confirm which identity users actually install** before writing the notice: the live npm page is unscoped **`memory-leak-detector`**, but this repo's `package.json` name is **`@mvladm14/memory-leak-detector`**. Deprecate/shim whichever one has real installs (possibly both).

## Out of scope (deferred to a later session)

- Publishing to npm, claiming the `@memleak` org, and running the actual `npm deprecate` + shim publish.
- Renaming the GitHub repo `react-memory-leak-detector` → `memleak`.
- `@memleak/angular`, `@memleak/svelte` adapters.
- Turborepo/Nx task caching.
