/**
 * Consumer-style type test. This file is never run or bundled — it exists so
 * `npm run typecheck` compiles the package's hand-written `.d.ts` files the way
 * a real consumer would import them (with `skipLibCheck: false`, so the
 * declaration files themselves are checked, not just their usage). It mirrors
 * the imports documented in the README; if any of those stop type-checking,
 * this fails in CI instead of in someone's editor.
 */
import type { HeapMarkersOptions } from "@memleak/react/babel-plugin";
import babelPluginHeapMarkers from "@memleak/react/babel-plugin";
import type { HeapMarkersViteOptions } from "@memleak/react";
import heapMarkers from "@memleak/react";
import type { HeapMarkersVueOptions } from "@memleak/vue";
import heapMarkersVue from "@memleak/vue";
import type { Plugin } from "vite";

// The runtime augments `Window` and exports its option/event types.
import type { HeapTrackerOptions, LeakEvent } from "@memleak/core/runtime";

// Babel plugin options (README: `import type { HeapMarkersOptions }`).
const babelOpts: HeapMarkersOptions = {
  include: /\.[tj]sx?$/,
  excludeNames: [/^useTranslation$/],
  trackHooks: true,
  leakAgeMs: 10000,
};
void babelPluginHeapMarkers;

// Vite plugin options extend the Babel options and add Vite-specific fields.
const viteOpts: HeapMarkersViteOptions = {
  ...babelOpts,
  engine: "oxc",
  exclude: /node_modules/,
  apply: "serve",
  silent: false,
  parserPlugins: ["decorators-legacy"],
};

// The Vite plugin returns a real Vite `Plugin`.
const plugin: Plugin = heapMarkers(viteOpts);
void plugin;

// The Vue plugin has its own (React-independent) options and also returns a
// real Vite `Plugin`.
const vueOpts: HeapMarkersVueOptions = {
  include: /\.vue$/,
  exclude: /node_modules/,
  apply: "serve",
  silent: false,
  excludeNames: [/^Legacy/],
  excludeUnmountTracking: [/Cached$/],
  leakAgeMs: 5000,
  logging: false,
};
const vuePlugin: Plugin = heapMarkersVue(vueOpts);
void vuePlugin;

// Runtime globals are typed (no ambient shim needed).
const runtimeOpts: Partial<HeapTrackerOptions> = { leakAgeMs: 5000, logging: false };
if (typeof window !== "undefined") {
  window.__heapTrackerOptions = runtimeOpts;
  const unsubscribe = window.__heapTracker?.subscribe((event: LeakEvent) => {
    void event.component;
    void event.stale;
  });
  void unsubscribe;
}
