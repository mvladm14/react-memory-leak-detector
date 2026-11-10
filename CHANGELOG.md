# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.2] - 2026-11-10

### Fixed

- **Components that cleaned up correctly were reported as leaks while they
  waited to be garbage-collected.** The runtime reported every instance still
  in memory `leakAgeMs` after unmount, whether or not a collection had run
  since. An idle tab can go a long time without one, so correct components
  reached the console and `subscribe()` listeners (and from there Sentry or
  any other sink) as leaks. An instance is now reported only when a *major*
  garbage collection that ran after it had been unmounted for `leakAgeMs`
  left it in memory. The evidence is a *witness*: an object the runtime
  holds until instances go stale, then releases. Witnesses are held through
  two collections first, so they are in the old generation, which only a
  major collection frees. A witness gone while a marker is still in memory
  means a major collection ran and something holds the component. Minor
  collections must not count. In Chrome, a cleared timer, a removed listener
  or a cancelled animation frame leaves a dead record in Blink's heap that
  still points at the component, and minor collections treat it as live. A
  component that cleaned up correctly survives every minor collection until
  the next major one. A first version of this fix allocated each witness with
  its marker, and it was fooled by this. With a minor collection forced after
  an unmount in Chromium, it reported all four fixed e2e components. Real
  leaks are still reported: at the first major collection after `leakAgeMs`,
  no longer at `leakAgeMs` itself. Clicking DevTools' **Collect garbage**, or
  calling `forceGc()` with `--expose-gc`, gives a verdict right away. Instances
  share the current witness for as long as it is still in memory, so one click
  judges every instance that went stale before it. A witness per unmount would
  empty the stock of old objects, and in an idle tab, after a burst of
  unmounts, every instance past the third needed extra clicks.

### Added

- **`awaitingGc` column in `report()`**: instances unmounted for `leakAgeMs`
  that no major collection has judged yet. `stale` now counts only instances
  that survived one, and so does the `stale` field of leak events.

### Changed

- The console warning now reads "… still retained after garbage collection"
  (the `Suspected leak: Name ` prefix is unchanged). The README's "Confirming
  a leak" section is replaced by "When leaks are reported".

### Internal

- `e2e/playwright/gc-lag.spec.ts` is no longer an expected failure and passes.
- New `e2e/playwright/gc-during-unmount.spec.ts` (Chromium, `--expose-gc`,
  `leakAgeMs: 0`): forces minor, major, or both collections synchronously
  inside the unmount, in a microtask after it, and in the next task. Then it
  sweeps without any further collection, and no fixed component may be
  reported. With young witnesses it fails on the minor collection in the next
  task; the released version passes all cases.
- New e2e test: ten leaked instances, each unmounted in a task of its own,
  must all be reported after a single DevTools "Collect garbage" click. With a
  witness per unmount, 3 of 10 were.
- New `__tests__/gc-lag.gc.ts` (real collections in Node): nothing is
  reported before a collection, and a collection that ran before the instance
  went stale doesn't count. A new e2e test forces minor GCs on a component
  adopted after a late runtime load. New unit tests cover the witness
  bookkeeping.
- Checked outside the suites with a stress script, not committed. It ran
  Chromium without `--expose-gc` at `leakAgeMs: 0`, with allocation churn
  that triggered up to 604 organic major collections per run (some runs with
  `--stress-incremental-marking`). There were no false reports in 4,800
  unmounts of the four fixed components, each unmount in its own task so
  instances share a witness across tasks. The leaky component was reported
  in every run. A young-witness build under the same conditions reported
  every fixed component.

## [1.4.1] - 2026-11-09

### Fixed

- **The React Compiler skipped every instrumented component in dev.** The
  injected marker declared `var _heap_ref_` / `var _heap_` and read
  `_heap_ref_.current` during render. The compiler bails out of a whole
  function on either ("Handle var kinds in VariableDeclaration", "Cannot access
  refs during render"), and does so silently by default. With the Vite plugin
  and the Next.js wrapper, which run before the compiler, every instrumented
  component and hook therefore ran uncompiled in dev while production ran
  compiled code. (With the Babel plugin in the same Babel pass as the compiler,
  the compiler runs first, so those setups were unaffected.) The marker is
  still held in a `useRef`, now `const _heap_ = __heap_useRef(null)`, and the
  render body reads `.current` only in the lazy-initialization check
  (`if (_heap_.current === null) { … }`), the form the compiler allows.
  Nested closures capture the ref itself (`_heap_ && 0;`, as before), which
  holds the marker, and the unmount effect reads the marker from the ref when
  it runs. Both engines emit it, and the compiler compiles the same functions
  with and without instrumentation. `ComponentName$Heap` markers, the runtime
  API and the heap-snapshot workflow are unchanged; in a snapshot's retainer
  chain, a leaked closure now reaches the marker through the ref's `current`
  property.
  Since `const` has a temporal dead zone, the Babel plugin no longer captures
  `_heap_` in closures placed *above* the declaration. `@babel/preset-env` puts
  lowered default parameters there when a target lowers parameters but keeps
  `const` (e.g. Edge 15); a default invoked during parameter evaluation
  (`{ items = list.map((x) => x) }`) would otherwise throw. Such closures were
  parameters in the source and, like other parameter closures, were never
  meant to be captured.

### Changed

- **README and `package.json` no longer overstate detection.** The README
  promised a warning "right away" and said "stale is the leak". Warnings come
  `leakAgeMs` (10 s) after unmount, and a stale component is a *suspected* leak:
  with default settings and no forced garbage collection, components that clean
  up correctly were reported too, in headless Chrome, whenever the browser
  hadn't collected them yet. The README now says so, adds a "Confirming a leak"
  section (DevTools' **Collect garbage** or `forceGc()`, then `report()`), and
  documents how `<Activity mode="hidden">` and the React Compiler interact with
  detection, and a React 17 case a forced collection doesn't clear: after
  unmounting a whole root, React 17 can keep the tree until its next render. The
  `package.json` description no longer calls the package a Babel plugin (it also
  ships Vite and Next.js integrations) and no longer claims leaks are caught
  "the moment" they happen.

### Internal

- **E2E check for garbage-collection lag** (`e2e/playwright/gc-lag.spec.ts`):
  runs the detector the way users do (Chromium without `--expose-gc`, default
  runtime options) and asserts that components that cleaned up correctly are
  not reported while they merely await collection, and that a real leak is
  reported once DevTools' "Collect garbage" has run. It is marked as an expected
  failure (`test.fail()`) until the runtime is fixed; runs where the browser
  freed the components on its own skip themselves as inconclusive, so the check
  can't pass or fail by luck. On the current runtime it failed as expected in all
  14 Vite combos.

- **React 17 and 19 coverage.** CI's unit/gc job now runs on React 18 and 19
  (times Node 18/20/22), plus React 17 on Node 22. New real-GC suites cover
  StrictMode, Suspense (hidden content and never-committed renders),
  `<Activity>` on React 19.2+ (pinning the known false positive and the
  `excludeUnmountTracking` workaround; skipped before 19.2, and a failure rather
  than a silent skip if 19.2+ lacks the export), and leak detection on
  components the React Compiler compiled, through the Oxc and Babel pre-passes
  and the same-pass Babel plugin. A transform test fails if the compiler stops
  compiling instrumented code. The Vite e2e matrix adds React 17 and React 19
  for all four plugin-react × engine combos, plus React 19 with the React
  Compiler (plugin-react v5), and checks that each combo really runs that React
  and, with the compiler, serves compiled modules. For React 17 the fixture
  mounts through a legacy-root (`ReactDOM.render`) twin of its mount module.
  `CHROMIUM_PATH` now works for the Vite e2e as it does for the Next.js one.

## [1.4.0] - 2026-11-08

### Added

- **Next.js integration** at `react-memory-leak-detector/next`:
  `export default withHeapMarkers(nextConfig, options)`. It runs the
  heap-markers transform as a pre-loader (same Oxc/Babel engines as the Vite
  plugin) and leaves Next's compiler alone, so no `.babelrc` is needed and SWC
  stays on. Only the development browser compilation is instrumented, which
  keeps production builds clean and never touches React Server Components.
  Works with webpack (any Next version) and Turbopack (Next 16+; on Next
  15.3–15.x Turbopack ignores the `browser` rule condition, so only
  `"use client"` files are instrumented there). Accepts the Babel plugin's
  options plus `engine`, `exclude`, `silent` and `parserPlugins`; typed as
  `HeapMarkersNextOptions`. The function form of `next.config` is supported.

### Fixed

- **Next.js apps failed to compile when following the README.** Verified
  against real Next 14, 15 and 16 apps (webpack and Turbopack, App and Pages
  Router) driven in headless Chrome. Four separate problems:
  - The documented `.babelrc` had no `"presets": ["next/babel"]`. A `.babelrc`
    replaces Next's Babel setup, so every file failed with
    `Support for the experimental syntax 'jsx' isn't currently enabled` /
    `Unexpected token`. Even with the preset, the `.babelrc` disables SWC under
    webpack, and the default create-next-app template then fails with
    `"next/font" requires SWC although Babel is being used`. The README now uses
    the new `/next` wrapper, and explains the preset and `skipServerComponents`
    for apps that already use Babel.
  - App Router Server Components that import from `react` received the injected
    `useRef`/`useEffect` and failed with `You're importing a component that needs
    useEffect… only works in a Client Component`. The wrapper never instruments
    them.
  - **Runtime could not be loaded by Node.** `dist/` is ESM, but the package has
    no `"type": "module"` and the runtime used extensionless relative imports,
    so loading it outside a bundler failed (`ERR_MODULE_NOT_FOUND: …/dist/config`
    on Node 22, `SyntaxError` on Node 18). Next hits this whenever the import runs
    on the server (`pages/_app.tsx`, SSR of a client component). The runtime now
    uses fully specified imports and the build writes `dist/package.json` with
    `{"type": "module"}`. Every `npm run build` then checks the result: it fails
    unless `dist/package.json` declares `"type": "module"` and plain Node can
    import `dist/runtime.js`.
  - **`/runtime` types were not found with `moduleResolution: "node"`**, the
    default tsconfig of Next 13/14 apps, so `next build` failed type checking on
    the README's `import("react-memory-leak-detector/runtime")`. Added
    `typesVersions` for the subpath.
- **Oxc engine: directive prologues.** The Oxc engine spliced its `react` import
  and runtime-config block in front of a file's `"use client"` directive, and the
  marker in front of function-level directives (`"use no memo"`,
  `"use strict"`). That demoted them to plain strings: with the Next.js wrapper
  under webpack, Next rejects every instrumented Client Component (`The "use
  client" directive must be placed before other expressions`), and a React
  Compiler `"use no memo"` opt-out was ignored. Injected code now goes after the
  prologue, matching the Babel engine.
- **Misleading errors when the Oxc engine can't load.** The Oxc load error told
  users to pass `engine: "babel"`, and the auto-detect fallback switched to
  Babel, but `@babel/core` is an optional peer dependency that Next.js apps
  usually lack. Every file then failed with `"@babel/core" is required when
  using the "babel" engine` (an engine the user never chose), and when
  `oxc-parser` wasn't installed at all, nothing mentioned Oxc. Now, when neither
  engine can run, instrumented files fail with one error that names both
  causes and both fixes (a supported Node version, or installing
  `@babel/core`). The fallback warning no longer gives the `engine: "babel"`
  advice. An explicit `engine: "oxc"` that can't load reports the Node version
  and platform and says Babel requires `@babel/core`, and no longer prints
  "using oxc engine" first.
- README: the runtime import for Next.js goes in `instrumentation-client.ts`
  (Next 15.3+), `pages/_app.tsx`, or a `"use client"` component. Placed in the
  App Router's `app/layout.tsx` (a Server Component), it never ran in the
  browser.

### Internal

- The Oxc-preferred/Babel-fallback engine selection moved from `vite.js` to
  `lib/engine.js`, so the Vite plugin and Next.js loader share it. No
  behavior change for Vite.
- **Next.js e2e matrix** (`e2e/next/`, CI job `e2e-next`): the packed tarball in
  real Next 14, 15.3, 15.5 and 16 apps across webpack and Turbopack, App and
  Pages Router.
  Per combo: live leak detection plus the no-false-positive check in headless
  Chromium, Server Components left uninstrumented, no page or dev-server
  errors, and a `next build` that type-checks and ships no markers. Each check
  was confirmed to fail when the bug it guards against is reintroduced.

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

[Unreleased]: https://github.com/mvladm14/react-memory-leak-detector/compare/v1.4.2...HEAD
[1.4.2]: https://github.com/mvladm14/react-memory-leak-detector/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/mvladm14/react-memory-leak-detector/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/mvladm14/react-memory-leak-detector/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/mvladm14/react-memory-leak-detector/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/mvladm14/react-memory-leak-detector/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/mvladm14/react-memory-leak-detector/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/mvladm14/react-memory-leak-detector/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mvladm14/react-memory-leak-detector/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/mvladm14/react-memory-leak-detector/releases/tag/v0.2.0
