// Type declarations for the CommonJS Vue Vite plugin in `vue.js`.
//
// Uses `export =` because the runtime is `module.exports = fn`. It reuses the
// host's installed `vite` types for the return value — you only ever use this
// with Vite.

import type { Plugin } from "vite";

/**
 * Vite plugin that tags every Vue 3 `<script setup>` component with a heap
 * marker + `onMounted`/`onUnmounted` lifecycle tracking, by injecting into the
 * SFC's script block in an `enforce: "pre"` step (via `@vue/compiler-sfc` +
 * `oxc-parser` + `magic-string`).
 *
 *   import heapMarkers from "@memleak/vue";
 *   plugins: [heapMarkers({ leakAgeMs: 5000 }), vue()]
 */
declare function heapMarkersVue(
  options?: heapMarkersVue.HeapMarkersVueOptions,
): Plugin;

declare namespace heapMarkersVue {
  export interface HeapMarkersVueOptions {
    /**
     * RegExp of files to transform. Only `.vue` files are ever considered.
     * @default /\.vue$/
     */
    include?: RegExp;
    /**
     * RegExp of files to skip, tested after `include`.
     * @default none
     */
    exclude?: RegExp;
    /**
     * Vite `apply` — when the plugin runs. Defaults to `"serve"` (dev server
     * only), so markers are stripped from production builds.
     * @default "serve"
     */
    apply?: Plugin["apply"];
    /**
     * Suppress the one-line "Vue plugin active" banner logged once at startup.
     * @default false
     */
    silent?: boolean;
    /**
     * RegExps matched against a component name. A match skips ALL instrumentation
     * for that component.
     * @default []
     */
    excludeNames?: RegExp[];
    /**
     * RegExps matched against a component name. A match keeps the `$Heap` marker
     * (still searchable in heap snapshots) but skips the `onMounted`/`onUnmounted`
     * lifecycle tracking. Use for components rendered under `<KeepAlive>` /
     * `<Suspense>`, whose teardown timing would otherwise cause false positives.
     * @default []
     */
    excludeUnmountTracking?: RegExp[];

    // Forwarded to the runtime at load time (injected as `window.__heapTrackerOptions`
    // when any differ from their defaults).

    /**
     * Runtime: disables automatic console warnings when false (tracking continues).
     * @default true
     */
    logging?: boolean;
    /**
     * Runtime: milliseconds an instance can stay unmounted-but-retained before it
     * is considered stale (a leak).
     * @default 10000
     */
    leakAgeMs?: number;
    /**
     * Runtime: minimum number of stale instances before a warning/event fires.
     * @default 1
     */
    suspectThreshold?: number;
    /**
     * Runtime: how often (ms) the sweep checks for leaks.
     * @default 2000
     */
    sweepIntervalMs?: number;
    /**
     * Runtime: how long (ms) to wait before warning about the SAME component again.
     * @default 30000
     */
    warnCooldownMs?: number;
  }
}

export = heapMarkersVue;
