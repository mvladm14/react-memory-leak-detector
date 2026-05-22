# react-memory-leak-detector

Live memory-leak detection for React components and hooks. No heap snapshot required.

A babel plugin tags every component and hook with a uniquely-named marker, and a runtime tracker uses `WeakRef` + `FinalizationRegistry` to warn you, **live in the console**, the moment a component is unmounted but still retained by some closure / event listener / timer / subscription.

Dev-only. Zero impact on production bundles.

## How it works

1. The babel plugin injects a uniquely-named `_heap_` marker into every component/hook — searchable as `ComponentName$Heap` in Chrome DevTools heap snapshots.
2. The runtime tracker wraps each marker in a `WeakRef` and registers it with a `FinalizationRegistry`. A sweep every 2s checks which markers are still reachable.
3. To know *when* a component actually unmounts, the babel plugin also injects a **synthetic `useEffect`** into every component and hook:

   ```js
   __heap_useEffect(() => {
     window.__heapTracker?.markMounted(_heap_);
     return () => window.__heapTracker?.markUnmounted(_heap_);
   }, []);
   ```

   Imported under a renamed alias so it can't collide with user code. A mount counter handles React StrictMode's double-invoke correctly.
4. If a `_heap_` is still reachable in JS ≥10s after its component unmounted, something is leaking it → console warning.

## Install

```bash
npm install --save-dev react-memory-leak-detector
```

## Wire-up (Vite + `@vitejs/plugin-react`)

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import heapMarkers from "react-memory-leak-detector/babel-plugin";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  return {
    plugins: [
      react({
        babel: {
          plugins: isDev ? [[heapMarkers, { /* options below */ }]] : [],
        },
      }),
    ],
  };
});
```

```js
// src/index.tsx (or your entry)
if (import.meta.env.DEV) {
  import("react-memory-leak-detector/runtime");
}
```

## Using it in the console

The tracker installs `window.__heapTracker` on dev page load. You'll see:

```
[heap-leak] tracker installed. Run window.__heapTracker.report() for a live table.
```

Warnings fire automatically as `console.warn`, debounced to once per 30s per component:

```
[heap-leak] Suspected leak: GapsByPriorityCard — 1 instance(s) unmounted >10s ago still retained (live 1 total)
```

Manual API:

| Call | Purpose |
| --- | --- |
| `window.__heapTracker.report()` | `console.table` of every component with live instances; also returns the array. |
| `window.__heapTracker.sweep()` | Force an immediate sweep (otherwise runs every 2s). |
| `window.__heapTracker.forceGc()` | `window.gc?.()` + re-sweep. Needs Chrome started with `--js-flags="--expose-gc"`. Use it to confirm a flag isn't just GC lag. |

Once a component shows up as stale, take a heap snapshot and search `ComponentName$Heap` → **Retainers** tab to find the offending closure.

## `live` vs `stale`

Both count `_heap_` instances still reachable in JS:

- **`live`** — total reachable instances. Includes currently-mounted, recently-unmounted (GC pending), and leaked.
- **`stale`** ⊆ `live` — only those where `markUnmounted` fired ≥10s ago. These are the leak suspects.

The leak signal is purely **`stale`**; `live` is context.

| Scenario | live | stale |
| --- | --- | --- |
| 80 cards on screen | 80 | 0 |
| Just navigated away, <10s ago | 0–80 | 0 |
| Unmounted but listener still holds 1 | 1+ | 1+ |

## Plugin options

```ts
heapMarkers({
  include: /\.[tj]sx?$/,              // file path regex
  excludeNames: [/^useTranslation$/], // names that skip ALL instrumentation
  excludeUnmountTracking: [],         // names that keep the heap marker but skip
                                      // the synthetic useEffect (use for components
                                      // managed by <Activity mode="hidden">)
  trackHooks: true,                   // when false, only components are instrumented
  skipServerComponents: false,        // when true, skip files without "use client"
})
```

All options are optional with sensible defaults.

## Compatibility

| React feature | Status |
| --- | --- |
| React 17 / 18 function components & hooks | ✅ |
| React 18 concurrent, Suspense, StrictMode | ✅ |
| SSR (effects no-op server-side) | ✅ |
| React Compiler | ✅ likely; warrants a CI snapshot test |
| `<Activity mode="hidden">` | ⚠️ use `excludeUnmountTracking` to opt out |
| React Server Components | ⚠️ use `skipServerComponents: true` |
| Class components | ❌ not instrumented (PRs welcome) |

## License

MIT
