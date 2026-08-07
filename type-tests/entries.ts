/**
 * Consumer-style type test. This file is never run or bundled — it exists so
 * `npm run typecheck` compiles the package's hand-written `.d.ts` files the way
 * a real consumer would import them (with `skipLibCheck: false`, so the
 * declaration files themselves are checked, not just their usage). It mirrors
 * the imports documented in the README; if any of those stop type-checking,
 * this fails in CI instead of in someone's editor.
 */
import type { HeapMarkersOptions } from "../babel-plugin";
import babelPluginHeapMarkers from "../babel-plugin";
import type { HeapMarkersViteOptions } from "../vite";
import heapMarkers from "../vite";
import type { Plugin } from "vite";

// The runtime augments `Window` and exports its option/event types.
import type { HeapTrackerOptions, LeakEvent } from "../dist/runtime";

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
