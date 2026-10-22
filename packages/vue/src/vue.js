/**
 * Vite plugin: memory-leak-detector (Vue 3).
 *
 * Instruments Vue 3 `<script setup>` Single-File Components so leaked component
 * instances show up live in the console (via `window.__heapTracker`) and are
 * searchable as `ComponentName$Heap` in Chrome DevTools heap snapshots. It's the
 * Vue counterpart to the React entry (`@memleak/react`), sharing the same runtime
 * tracker (`@memleak/core/runtime`) and the same `@memleak/core` injection
 * machinery.
 *
 * Unlike the React entry there is no engine choice: Vue rides the Oxc engine
 * (`oxc-parser` + `magic-string`) with `@vue/compiler-sfc` splitting the SFC.
 * There is no Babel fallback, so if those dependencies can't load the plugin
 * throws an actionable error rather than silently doing nothing.
 *
 * Usage (dev-only by default — `apply: "serve"`, so markers never reach a
 * production build):
 *
 *   import { defineConfig } from "vite";
 *   import vue from "@vitejs/plugin-vue";
 *   import heapMarkers from "@memleak/vue";
 *
 *   export default defineConfig({
 *     plugins: [heapMarkers(), vue()],
 *   });
 *
 * Then import the runtime once at app boot (dev):
 *
 *   import "@memleak/core/runtime";
 *
 * heapMarkers() runs at `enforce: "pre"` and `@vitejs/plugin-vue`'s main
 * transform does not, so heapMarkers always sees the raw SFC first regardless of
 * array order — but listing it before vue() keeps intent obvious.
 *
 * Options (all optional): include, exclude, apply, silent, excludeNames,
 * excludeUnmountTracking, logging, leakAgeMs, suspectThreshold, sweepIntervalMs,
 * warnCooldownMs. See ./vue.d.ts.
 */

let announced = false;

function banner(silent) {
  if (announced || silent) return;
  announced = true;
  // eslint-disable-next-line no-console
  console.log('[memory-leak-detector] Vue plugin active (<script setup> SFCs)');
}

module.exports = function heapMarkersVue(options = {}) {
  const { silent = false, ...rest } = options;
  const engineVue = require("./engine-vue");
  const plugin = engineVue(rest);

  // Thin wrapper: emit the one-line banner the first time a file is actually
  // instrumented. Dependency-load failures (VUE_DEPS_UNAVAILABLE) propagate as-is
  // — there's no fallback engine, and a clear error beats silent no-ops.
  return {
    name: plugin.name,
    enforce: plugin.enforce,
    apply: plugin.apply,
    async transform(code, id) {
      const result = await plugin.transform.call(this, code, id);
      if (result != null) banner(silent);
      return result;
    },
  };
};

module.exports.default = module.exports;
