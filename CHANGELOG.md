# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.1] - 2026-10-23

### Fixed

- **Default-parameter callbacks no longer crash.** Both the Babel plugin and
  the Oxc engine injected the `_heap_ && 0` closure capture into closures
  declared in a component's or hook's *own* parameter list (e.g.
  `function Item({ onSelect = () => {} })`, `useFormat(fmt = (v) => String(v))`).
  Parameter expressions get their own environment and can't see the body's
  `var _heap_`, so invoking the default threw
  `ReferenceError: _heap_ is not defined` — a hard crash in dev for the common
  default-callback-prop idiom. Those closures are now left untouched; closures
  in the body (including defaults of nested helper functions) are still
  captured. The Babel plugin now decides by scope rather than by position: a
  closure captures `_heap_` only when it sits lexically inside the block that
  declares it. That keeps the rule correct in same-pass Babel setups where
  `@babel/preset-env` downlevels default parameters into the body (and, when a
  body binding shadows a parameter name, wraps the body in an IIFE and leaves
  the lowered defaults outside it), regardless of how other transforms clone
  or rebuild the closure nodes. Both engines also agree on a nested
  instrumented function's own params: never captured. Covered by transform
  tests for both engines (including rendered preset-env same-pass cases with
  arrow, object-method, class and generator defaults) and a runtime test that
  renders a component with default callbacks through the real plugin.
- **Babel plugin: duplicate `_heap_ && 0;` capture in same-pass setups.** When
  the plugin ran in the same Babel pass as `@babel/preset-react` (webpack/Next
  `.babelrc`, babel-jest), an arrow function inside a JSX attribute received the
  closure-capture statement twice: preset-react replaces the JSX element with a
  `createElement()` call and Babel re-queues the new subtree, so the same arrow
  node reached the plugin's visitor a second time. The plugin now remembers
  which closures it has already injected into and skips re-visits. Harmless at
  runtime, but it inflated output and made capture counts unreliable. The Oxc
  engine (single-pass string splice) was never affected.
- **Components rendered before the runtime loads were never tracked.** The
  documented install (`if (import.meta.env.DEV) import("…/runtime")`) resolves
  after React's first render and commit, so every component in the initial
  tree (app shell, layouts, landing route) called `track()` while
  `window.__heapTracker` was still absent; the injected code never retries,
  and `markMounted` / `markUnmounted` ignored unknown instances. Their leaks
  were silently dropped. The runtime now adopts an instance it has not seen on
  its first `markMounted` / `markUnmounted`, recovering the component name from
  the `ComponentName$Heap` marker constructor (an instance first seen at
  unmount is recorded as already unmounted, so the sweep can judge it). No
  change to the injected code or to tracking of components rendered after the
  runtime loaded. Covered by unit tests, a real-GC suite that renders before
  importing the runtime, and an e2e entry (`e2e/fixture/late.html`) that
  installs the runtime with the README's dynamic `import()`.
- README: `window.__heapTracker.subscribe(...)` placed right after the
  fire-and-forget `import()` threw (the tracker was not installed yet) and did
  not type-check (the global is optional). The snippets now chain `.then()` on
  the import and use `window.__heapTracker?.subscribe`; both forms are covered
  by `npm run typecheck`.

## [1.3.0] - 2026-08-07

### Changed

- **Optimized install-time file footprint**: Moved `@babel/core` from `dependencies` to `peerDependencies` with `optional: true` in `peerDependenciesMeta`. Modern Vite or Non-Babel users now avoid downloading ~10–15 MB of compiler transitive dependency trees in their `node_modules` during installation.
- `@babel/core` is now conditionally and lazily dynamic-loaded in the build plugins, resolving and loading only when explicit `"babel"` compilation engine transforms are executed, outputting clean actionable failures when unavailable.

## [1.2.0] - 2026-08-07

### Added

- **First-class Vite plugin** at `react-memory-leak-detector/vite`, compatible
  with `@vitejs/plugin-react` **v5 and v6+** (Oxc), `@vitejs/plugin-react-swc`,
  or no React plugin at all. It runs the heap-markers transform itself in an
  `enforce: "pre"` step instead of relying on the React plugin's `babel` option
  (which v6 removed). Place `heapMarkers()` **before** `react()` in the plugins
  array (see README). Applies to the dev server only by default
  (`apply: "serve"`), so markers are stripped from production builds. Accepts the
  Babel plugin's options plus `include`, `exclude`, `apply`, and `parserPlugins`;
  the options type is exported as `HeapMarkersViteOptions`. This is the
  recommended way to wire up Vite.
  - `parserPlugins` opts extra `@babel/parser` plugins in (e.g.
    `["decorators-legacy"]`). The marker step parses with Babel — not the app's
    transformer — and reads no project Babel config, so source using non-default
    syntax needs its parser plugin listed here.
  - `exclude` skips files matching a RegExp; `include` now also matches
    `.mjs`/`.cjs`/`.mts`/`.cts`.
  - The plugin only re-emits files it actually instruments; react-importing
    modules with no component/hook to mark are passed through untouched (no
    needless Babel round-trip or sourcemap).
- `@babel/core` is now a runtime `dependency` (the Vite plugin invokes Babel
  itself rather than piggy-backing on the host's Babel setup).
- **Oxc engine for the Vite plugin**, selected via a new `engine` option
  (`"oxc" | "babel"`). The Oxc engine parses with `oxc-parser` and injects
  markers surgically with `magic-string` — no `@babel/core`, no full reprint,
  and it parses TS/JSX/decorators natively (so `parserPlugins` is a no-op for
  it). Both engines emit identical markers, so the runtime and heap-snapshot
  workflow are unchanged. When `engine` is omitted the plugin auto-detects,
  preferring Oxc and falling back to Babel if `oxc-parser` can't be loaded. The
  fallback is evaluated at transform time (not just at resolve time), so a
  missing or unusable Oxc degrades to Babel with a one-line warning instead of
  crashing the dev server. An explicit `engine: "oxc"` surfaces the load error
  rather than switching engines.
  - `oxc-parser` and `magic-string` are `optionalDependencies` — the package
    keeps its `node >=16` support for the Babel engine and core plugin, while
    `oxc-parser` itself needs **Node ^20.19 or >=22.12** and prebuilt native
    bindings. On older Node or an unsupported platform they may be skipped or
    fail to load, and the plugin transparently falls back to Babel. Both are
    ESM-only and loaded lazily via dynamic `import()`, so the Oxc engine's
    `transform` hook is async and works on Node versions without `require(esm)`.
  - The Vite plugin's internals moved to `lib/engine-oxc.js` /
    `lib/engine-babel.js` behind a thin dispatcher in `vite.js`; shared
    detection predicates live in `lib/predicates.js`. Public entry point and
    options are unchanged apart from the added `engine`.

### Changed

- README: the Vite setup now leads with `react-memory-leak-detector/vite`,
  documents the `engine` option and the two engines, and keeps the v5
  `babel`-option wiring as an alternative. Removes the previous "requires
  `@vitejs/plugin-react` v5 / v6 not supported yet" caveat — v6 is now supported
  via the Vite plugin.
- Test runner now enables `--experimental-vm-modules` so Jest can load the
  ESM-only `oxc-parser` / `magic-string` via dynamic `import()`.

### Fixed

- **Engine parity — nested function declarations.** The Babel engine now injects
  the `_heap_ && 0` closure-capture into nested `function` declarations (e.g. an
  event handler attached without cleanup), matching the Oxc engine. Previously
  only arrow functions, function expressions, and object/class methods were
  captured, so a leak whose sole retainer was a nested function declaration went
  undetected under the Babel engine.
- **Engine parity — synthetic effect.** The Babel engine no longer injects
  `_heap_ && 0` into its own synthetic unmount effect (it already references
  `_heap_`), which also removes a double-injection there. Output now matches the
  Oxc engine closure-for-closure.
- **Plugin ordering.** The Vite plugin warns at startup if a JSX-compiling React
  plugin (`@vitejs/plugin-react` v5) is ordered ahead of it — which would strip
  JSX before markers are injected and silently leave components uninstrumented.
  The README no longer claims order is irrelevant; place `heapMarkers()` first.

## [1.1.0] - 2026-08-03

### Added

- **Shipped TypeScript declarations** for both entry points via the `exports`
  map (`/babel-plugin`, `/runtime`), so consumers no longer need hand-written
  ambient `declare module` shims. `babel-plugin.d.ts` exports the
  `HeapMarkersOptions` type.
- **Typed `window.__heapTrackerOptions`** on the global `Window` augmentation
  (alongside the existing `window.__heapTracker`).
- Regression tests for runtime install (idempotency + pre-load options).

### Fixed

- **Idempotent runtime install.** A second evaluation of the runtime (HMR
  reload, a duplicate import, or the dep resolved under two specifiers) no
  longer replaces the live tracker with a fresh, empty-state one, starts a
  second sweep loop, or re-logs the "tracker installed" message — the original
  tracker and its accumulated state are kept.

### Changed

- README: added a TypeScript section and a heap-snapshot walkthrough for
  finding a leak, clarified how build-time vs runtime options are forwarded, and
  noted that the Vite setup currently requires `@vitejs/plugin-react` v5 (v6+
  uses Oxc and dropped the `babel` option; first-class v6 support is planned).

## [1.0.0] - 2026-07-23

First stable release. No breaking changes from 0.2.0 — the public API
(`react-memory-leak-detector/babel-plugin`, `react-memory-leak-detector/runtime`,
and the `window.__heapTracker` surface) is now considered stable and covered
by semantic versioning.

### Changed

- README restructured for readability: installation and setup first, then
  usage (leading with `subscribe()`), API reference, configuration, and
  internals ("How it works") near the end.
- `repository.url` in package.json normalized to the canonical
  `git+https://` form.

## [0.2.0] - 2026-05-25

First public release on npm.

### Added

- **Babel plugin** (`react-memory-leak-detector/babel-plugin`) that injects a
  uniquely-named `_heap_` marker into every React component and hook, searchable
  as `ComponentName$Heap` in Chrome DevTools heap snapshots.
- **Runtime tracker** (`react-memory-leak-detector/runtime`) using `WeakRef` +
  `FinalizationRegistry` to detect components that remain reachable after
  unmount. Installs as `window.__heapTracker` and runs a sweep loop every 2s
  (configurable).
- **Synthetic `useEffect` injection** so the tracker knows when a component
  actually unmounts. StrictMode-aware via a mount counter.
- **`window.__heapTracker.subscribe(listener)`** — programmatic subscription
  to stale-leak events. Listener fires with `{ component, stale, live,
leakAgeMs, at }` only for stale leaks (instances unmounted ≥ `leakAgeMs` ago
  and still reachable), gated by the same `suspectThreshold` and
  `warnCooldownMs` as the console warning. Returns an unsubscribe function.
- **`window.__heapTracker.report()`** — `console.table` snapshot of every
  component with live/stale counts.
- **`window.__heapTracker.sweep()`** — force an immediate sweep.
- **`window.__heapTracker.forceGc()`** — `window.gc?.()` + re-sweep (requires
  Chrome started with `--js-flags="--expose-gc"`).
- **`window.__heapTracker.configure()`** — hot-update runtime options
  (logging, thresholds, sweep cadence).
- Plugin options: `include`, `excludeNames`, `excludeUnmountTracking`,
  `trackHooks`, `skipServerComponents`, `logging`, `leakAgeMs`,
  `suspectThreshold`, `sweepIntervalMs`, `warnCooldownMs`.
- Test suite covering the runtime modules (config, store, subscribers,
  lifecycle, sweep) and the babel plugin transforms.

### Internal

- Runtime split into focused modules (`types`, `config`, `store`, `lifecycle`,
  `subscribers`, `sweep`) with `runtime.ts` as the entry that wires the API
  and starts the sweep loop. No change to the public surface.

[Unreleased]: https://github.com/mvladm14/react-memory-leak-detector/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/mvladm14/react-memory-leak-detector/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/mvladm14/react-memory-leak-detector/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mvladm14/react-memory-leak-detector/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/mvladm14/react-memory-leak-detector/releases/tag/v0.2.0
