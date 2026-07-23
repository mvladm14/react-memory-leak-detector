# react-memory-leak-detector

Live memory-leak detection for React components and hooks. No heap snapshot required.

The moment a component is unmounted but still retained — by a closure, event listener, timer, or subscription — you know about it: as a **leak event you can subscribe to** and forward anywhere (a debug overlay, your own logger, Sentry), or as a **live console warning**. Under the hood, a babel plugin tags every component and hook, and a runtime tracker watches those tags with `WeakRef` + `FinalizationRegistry`.

Dev-only. Zero impact on production bundles.

## Installation

```bash
npm install --save-dev react-memory-leak-detector
```

This package provides two pieces that must be configured:

1. The **Babel Plugin** (`react-memory-leak-detector/babel-plugin`) to inject the tracking markers.
2. The **Runtime** (`react-memory-leak-detector/runtime`) to collect data and warn you in the console.

## Setup

### 1. Add the Babel plugin

You only want this plugin active in development environments.

**Vite + `@vitejs/plugin-react`**
Vite uses esbuild by default, but its official React plugin exposes Babel configuration:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import heapMarkers from "react-memory-leak-detector/babel-plugin";

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      react({
        babel: {
          plugins:
            mode === "development"
              ? [
                  [
                    heapMarkers,
                    {
                      /* options */
                    },
                  ],
                ]
              : [],
        },
      }),
    ],
  };
});
```

**Webpack / Next.js / standard Babel**
Add the plugin to your `.babelrc`, `babel.config.js`, or Webpack `babel-loader` options for the development environment.

```json
// .babelrc
{
  "env": {
    "development": {
      "plugins": ["react-memory-leak-detector/babel-plugin"]
    }
  }
}
```

### 2. Import the runtime

Inject the runtime into the very beginning of your application (e.g., `src/index.tsx`, `src/main.tsx`, or `_app.tsx`). The runtime must be dynamically imported or guarded so it does not end up in your production bundle.

**For Webpack / Next.js:**

```js
// src/index.tsx
if (process.env.NODE_ENV === "development") {
  import("react-memory-leak-detector/runtime");
}
```

**For Vite:**

```js
// src/main.tsx
if (import.meta.env.DEV) {
  import("react-memory-leak-detector/runtime");
}
```

## Usage

The tracker installs `window.__heapTracker` on dev page load.

### Subscribing to leaks

Use `subscribe` to forward stale-leak events wherever they're most useful — your own logger, a debug overlay, Sentry, etc. The listener only fires for **stale** leaks (instances unmounted ≥ `leakAgeMs` ago and still reachable), never for currently-mounted or recently-unmounted components.

```ts
const unsubscribe = window.__heapTracker.subscribe((event) => {
  // event: { component, stale, live, leakAgeMs, at }
  console.log(`Leak in ${event.component}: ${event.stale} stale instance(s)`);
  // e.g. Sentry.captureMessage(`heap-leak:${event.component}`, { extra: event });
});

// later
unsubscribe();
```

Event shape:

| Field        | Type     | Description                                                                       |
| ------------ | -------- | --------------------------------------------------------------------------------- |
| `component`  | `string` | Component / hook name. Matches the `ComponentName$Heap` marker in heap snapshots. |
| `stale`      | `number` | Instances unmounted ≥ `leakAgeMs` ago that are still reachable.                   |
| `live`       | `number` | Total reachable instances (mounted + recently-unmounted + leaked).                |
| `leakAgeMs`  | `number` | Threshold used to classify an instance as stale.                                  |
| `at`         | `number` | `Date.now()` when the event was fired.                                            |

Firing is gated by the same `suspectThreshold` and `warnCooldownMs` as the console warning below, so you won't get spammed. To receive events without the console warnings, call `configure({ logging: false })`.

### Console warnings

On dev page load you'll see:

```
[heap-leak] tracker installed. Run window.__heapTracker.report() for a live table.
```

Warnings fire automatically as `console.warn`, debounced to once per 30s per component:

```
[heap-leak] Suspected leak: GapsByPriorityCard — 1 instance(s) unmounted >10s ago still retained (live 1 total)
```

### Reading the numbers: `live` vs `stale`

Both count `_heap_` instances still reachable in JS:

- **`live`** — total reachable instances. Includes currently-mounted, recently-unmounted (GC pending), and leaked.
- **`stale`** ⊆ `live` — only those where `markUnmounted` fired ≥10s ago. These are the leak suspects.

The leak signal is purely **`stale`**; `live` is context.

| Scenario                             | live | stale |
| ------------------------------------ | ---- | ----- |
| 80 cards on screen                   | 80   | 0     |
| Just navigated away, <10s ago        | 0–80 | 0     |
| Unmounted but listener still holds 1 | 1+   | 1+    |

### Finding the leak

Once a component shows up as stale, take a heap snapshot in Chrome DevTools and search for `ComponentName$Heap` → open the **Retainers** tab to find the offending closure.

## API

| Call                               | Purpose                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `window.__heapTracker.report()`    | `console.table` of every component with live instances; also returns the array.                                               |
| `window.__heapTracker.configure()` | Configure runtime options. Example: `configure({ logging: false })` disables all console outputs while continuing tracking.   |
| `window.__heapTracker.sweep()`     | Force an immediate sweep (otherwise runs every 2s).                                                                           |
| `window.__heapTracker.forceGc()`   | `window.gc?.()` + re-sweep. Needs Chrome started with `--js-flags="--expose-gc"`. Use it to confirm a flag isn't just GC lag. |
| `window.__heapTracker.subscribe()` | Subscribe to stale-leak events (see [Subscribing to leaks](#subscribing-to-leaks)). Fires only for stale leaks, gated by the same `suspectThreshold` + `warnCooldownMs` as the console warning. Returns an unsubscribe function. |

## Configuration

```ts
heapMarkers({
  include: /\.[tj]sx?$/, // file path regex
  excludeNames: [/^useTranslation$/], // names that skip ALL instrumentation
  excludeUnmountTracking: [], // names that keep the heap marker but skip
  // the synthetic useEffect (use for components
  // managed by <Activity mode="hidden">)
  trackHooks: true, // when false, only components are instrumented
  skipServerComponents: false, // when true, skip files without "use client"
  logging: true, // when false, disables automatic console warnings
  leakAgeMs: 10000, // time in ms before an unmounted component is considered leaked
  suspectThreshold: 1, // minimum number of stale instances before warning
  sweepIntervalMs: 2000, // how often the GC sweep checks for leaks
  warnCooldownMs: 30000, // how long to wait before warning about the SAME component again
});
```

All options are optional with sensible defaults.

## How it works

1. The babel plugin injects a uniquely-named `_heap_` marker into every component/hook — searchable as `ComponentName$Heap` in Chrome DevTools heap snapshots.
2. The runtime tracker wraps each marker in a `WeakRef` and registers it with a `FinalizationRegistry`. A sweep every 2s checks which markers are still reachable.
3. To know _when_ a component actually unmounts, the babel plugin also injects a **synthetic `useEffect`** into every component and hook:

   ```js
   __heap_useEffect(() => {
     window.__heapTracker?.markMounted(_heap_);
     return () => window.__heapTracker?.markUnmounted(_heap_);
   }, []);
   ```

   Imported under a renamed alias so it can't collide with user code. A mount counter handles React StrictMode's double-invoke correctly.

4. If a `_heap_` is still reachable in JS ≥10s after its component unmounted, something is leaking it → console warning.

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

## License

MIT
