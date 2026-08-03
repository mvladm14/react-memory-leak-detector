# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/mvladm14/react-memory-leak-detector/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/mvladm14/react-memory-leak-detector/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mvladm14/react-memory-leak-detector/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/mvladm14/react-memory-leak-detector/releases/tag/v0.2.0
