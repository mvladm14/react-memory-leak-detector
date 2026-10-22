# memleak

Catch React **and Vue** memory leaks the moment they happen — no heap snapshots required.

When a component unmounts but something still holds onto it (a stray timer,
listener, subscription, or closure), you get a **console warning** right away and
a **leak event** you can forward to your own logger or Sentry. Dev-only — it
compiles out of production builds.

The runtime tracker is framework-agnostic; a small build-time plugin per
framework tags each component so the tracker can see it. React (components +
hooks) and Vue 3 (`<script setup>` SFCs) are supported today.

`memleak` is an npm-workspaces monorepo:

| Package | What it is |
| ------- | ---------- |
| [`@memleak/core`](packages/core) | Framework-agnostic runtime tracker (`@memleak/core/runtime`) + shared build-time machinery. A dependency of the adapters. |
| [`@memleak/react`](packages/react) | React Vite plugin + standalone Babel plugin. |
| [`@memleak/vue`](packages/vue) | Vue 3 `<script setup>` Vite plugin. |

## Install

Install the adapter for your framework — `@memleak/core` (which carries the
runtime) comes along as a dependency:

```bash
# React
npm install --save-dev @memleak/react

# Vue 3
npm install --save-dev @memleak/vue
```

## Setup

Two steps: add the build plugin for your framework, then import the runtime once in dev.

### 1. Add the plugin

**React + Vite**

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import heapMarkers from "@memleak/react";

export default defineConfig({
  plugins: [
    heapMarkers(), // list it BEFORE react()
    react(),
  ],
});
```

Dev-only by default, so nothing ships to production. Works with any
`@vitejs/plugin-react` version (or none). Keep `heapMarkers()` before `react()` —
it warns you at startup if the order is wrong.

**Vue 3 + Vite**

```ts
// vite.config.ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import heapMarkers from "@memleak/vue";

export default defineConfig({
  plugins: [
    heapMarkers(), // before vue()
    vue(),
  ],
});
```

Instruments Vue 3 `<script setup>` SFCs. Dev-only by default. `heapMarkers()`
runs at `enforce: "pre"` so it always sees the raw SFC before `@vitejs/plugin-vue`
compiles it, regardless of array order. See [Vue coverage](#vue-coverage) for what
is and isn't tracked.

**Webpack / Next.js / Babel (React only)** — add the plugin to your Babel config, in development:

```json
// .babelrc
{ "env": { "development": { "plugins": ["@memleak/react/babel-plugin"] } } }
```

### 2. Import the runtime

Load it once at the top of your app entry, in dev only (same for both frameworks):

```js
// Vite
if (import.meta.env.DEV) import("@memleak/core/runtime");

// Webpack / Next.js
if (process.env.NODE_ENV === "development") import("@memleak/core/runtime");
```

That's it. Type declarations are bundled, so TypeScript needs no extra setup.

## Getting leaks

On page load the tracker installs, and leaks show up as console warnings as they
happen:

```
[heap-leak] Suspected leak: UserCard — 1 instance(s) unmounted >10s ago still retained (live 1 total)
```

Any time, run `window.__heapTracker.report()` for a live table of tracked
components. Two numbers matter:

- **live** — instances still in memory (mounted, or unmounted and not yet collected).
- **stale** — unmounted more than `leakAgeMs` ago and *still* in memory. **Stale is the leak.**

Prefer to handle leaks yourself — a debug overlay, your logger, Sentry? Subscribe:

```ts
const unsubscribe = window.__heapTracker.subscribe((event) => {
  // { component, stale, live, leakAgeMs, at }
  Sentry.captureMessage(`heap-leak:${event.component}`, { extra: event });
});
```

Events fire only for stale leaks and are debounced per component.
`configure({ logging: false })` keeps the events but silences the console.

## Finding the cause

A stale component tells you *what* leaked; a heap snapshot tells you *why*. In
Chrome DevTools → Memory, take a snapshot and filter for `ComponentName$Heap`:

![Heap snapshot: LeakyTimeout$Heap instances retained, with the Retainers panel showing a DOMTimer holding them](docs/leaky-timeout-heapsnapshot.png)

Each row is a leaked instance. Select one and read the **Retainers** panel
bottom-up to see what's holding it — here a `DOMTimer`, i.e. an uncleared
`setTimeout`/`setInterval`. Clean it up on unmount and the instances disappear.

## Configuration

All options are optional. The common ones, passed to the plugin:

```ts
heapMarkers({
  leakAgeMs: 10000,   // ms unmounted-but-retained before it counts as a leak
  logging: true,      // console warnings on/off
  trackHooks: true,   // also track custom hooks, not just components
  excludeNames: [/^useTranslation$/], // component/hook names to skip entirely
});
```

Runtime options can also be changed live:
`window.__heapTracker.configure({ leakAgeMs: 5000 })`.

## Compatibility

| React feature                             | Status                                     |
| ----------------------------------------- | ------------------------------------------ |
| React 17 / 18 function components & hooks | ✅                                         |
| React 18 concurrent, Suspense, StrictMode | ✅                                         |
| SSR (effects no-op server-side)           | ✅                                         |
| React Compiler                            | ✅ likely; warrants a CI snapshot test     |
| `<Activity mode="hidden">`                | ⚠️ use `excludeUnmountTracking` to opt out |
| React Server Components                   | ⚠️ use `skipServerComponents: true`        |
| Class components                          | ❌ not instrumented (PRs welcome)          |

<a name="vue-coverage"></a>

### Vue coverage

The Vue plugin (`@memleak/vue`) instruments **Vue 3 `<script setup>` SFCs**. Each such
component gets a `ComponentName$Heap` marker (named from the filename, or from
`defineOptions({ name })`) plus `onMounted`/`onUnmounted` live tracking, and every
closure defined in the script block captures the marker.

| Vue case                                          | Status                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `<script setup>` SFCs                             | ✅                                                                  |
| Composables/handlers/watchers defined in `<script setup>` | ✅ captured                                                 |
| `defineComponent` / `setup()` / Options API       | ❌ not yet (only `<script setup>`)                                  |
| Inline template handlers (`@click="() => …"`)     | ❌ compiled into the render fn; use a named script handler instead  |
| `<KeepAlive>` / `<Suspense>` cached components     | ⚠️ `onUnmounted` may not fire → false positives; use `excludeUnmountTracking` |

Options that don't apply to Vue (`trackHooks`, `skipServerComponents`, `engine`,
`parserPlugins`) are React-only. Everything else — `leakAgeMs`, `logging`,
`excludeNames`, `excludeUnmountTracking`, and the runtime — is shared.

> **Vue Devtools & the first few seconds.** In dev with **no Vue Devtools
> connected**, Vue's dev build briefly holds every mounted component instance in
> an internal devtools "replay" buffer (`window.__VUE_DEVTOOLS_HOOK_REPLAY__`),
> which it clears on its own about **3 seconds** after startup. During that
> window a just-unmounted component can look retained even after it's cleaned up.
> With the default `leakAgeMs` (10s) this never surfaces — the buffer is gone
> long before anything is flagged. Only relevant if you set a very low
> `leakAgeMs`: keep Vue Devtools open, or ignore the first few seconds after load.

<details>
<summary>Advanced — all options, API, engines, and how it works</summary>

### All plugin options

```ts
heapMarkers({
  // ── build-time: what gets instrumented ──
  include: /\.[tj]sx?$/,              // files to process
  excludeNames: [/^useTranslation$/], // names that skip ALL instrumentation
  excludeUnmountTracking: [],         // names that keep the heap marker but skip
                                      //   the unmount effect — use for components
                                      //   under <Activity mode="hidden">, whose
                                      //   cleanup fires while still alive
  trackHooks: true,                   // false = components only
  skipServerComponents: false,        // true = skip files without "use client" (RSC)

  // ── runtime: how leaks are judged/reported (injected into the app) ──
  logging: true,                      // false = track silently, no console warnings
  leakAgeMs: 10000,                   // age before an unmounted instance is "stale"
  suspectThreshold: 1,                // min stale instances before warning/event
  sweepIntervalMs: 2000,              // how often the sweep runs
  warnCooldownMs: 30000,              // min gap between warnings for the same component
});
```

Runtime options can also be set before load (`window.__heapTrackerOptions = { … }`,
e.g. at the top of `main.tsx`) or live (`window.__heapTracker.configure({ … })`).

### `window.__heapTracker` API

| Call | Purpose |
| ---- | ------- |
| `report()` | `console.table` of every component with live instances; also returns the array. |
| `subscribe(fn)` | Listen for stale-leak events; returns an unsubscribe function. |
| `configure(opts)` | Update runtime options (e.g. `{ logging: false }`). |
| `sweep()` | Force an immediate sweep (otherwise every `sweepIntervalMs`). |
| `forceGc()` | `window.gc?.()` + re-sweep. Needs Chrome started with `--js-flags="--expose-gc"`; use it to rule out plain GC lag. |

Leak event shape: `{ component, stale, live, leakAgeMs, at }`. `component` matches
the `ComponentName$Heap` marker in heap snapshots.

### Engines (Vite plugin)

The Vite plugin injects markers with **Oxc** by default and falls back to
**Babel** automatically if `oxc-parser` can't load — you normally don't touch
this. Force one with `heapMarkers({ engine: "oxc" })` or `"babel"`. The Babel
engine parses with Babel and reads no project config, so non-default syntax
(decorators, `using`, import attributes) needs its parser opted in, e.g.
`heapMarkers({ engine: "babel", parserPlugins: ["decorators-legacy"] })`; the Oxc
engine parses these natively. `oxc-parser` needs Node ^20.19 or >=22.12.

TypeScript option types are exported as `HeapMarkersOptions`
(`@memleak/react/babel-plugin`), `HeapMarkersViteOptions` (`@memleak/react`), and
`HeapMarkersVueOptions` (`@memleak/vue`). The Vue plugin uses Oxc +
`@vue/compiler-sfc` only (no Babel fallback).

### How it works

1. The plugin tags every component/hook with a uniquely-named marker —
   searchable as `ComponentName$Heap` in heap snapshots — and injects a synthetic
   lifecycle hook that reports mount/unmount (React `useEffect`; Vue
   `onMounted`/`onUnmounted`).
2. The runtime holds each marker in a `WeakRef` + `FinalizationRegistry` and
   sweeps periodically.
3. If a marker is still reachable well after its component unmounted, something
   is leaking it → warning + event.

</details>

## License

MIT
