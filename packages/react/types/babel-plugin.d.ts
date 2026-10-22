// Type declarations for the CommonJS Babel plugin in `babel-plugin.js`.
//
// The runtime file is `module.exports = fn`, so this uses `export =`. To also
// expose the option types, the function is merged with a namespace of the same
// name (a single export assignment — you can't combine `export =` with other
// `export` statements). Dependency-free (no `@babel/core` import) so consumers
// don't need Babel's types installed just to reference the plugin.

/**
 * Babel plugin that tags every React component/hook with a uniquely-named heap
 * marker and a synthetic unmount-tracking effect. Use it as `[heapMarkers, options]`.
 */
declare function babelPluginHeapMarkers(
  babel: unknown,
  options?: babelPluginHeapMarkers.HeapMarkersOptions,
): babelPluginHeapMarkers.BabelPlugin;

declare namespace babelPluginHeapMarkers {
  export interface HeapMarkersOptions {
    /**
     * RegExp matched against the file path. Files not matching are skipped entirely.
     * @default /\.[tj]sx?$/
     */
    include?: RegExp;
    /**
     * RegExps matched against a component/hook name. A match skips ALL
     * instrumentation for that function.
     * @default []
     */
    excludeNames?: RegExp[];
    /**
     * RegExps matched against a name. A match keeps the `$Heap` marker (still
     * searchable in heap snapshots) but skips the synthetic unmount-tracking
     * effect. Use for components managed by `<Activity mode="hidden">`.
     * @default []
     */
    excludeUnmountTracking?: RegExp[];
    /**
     * When false, custom hooks (`use*`) are not instrumented; only components are.
     * @default true
     */
    trackHooks?: boolean;
    /**
     * When true, files that don't begin with a `"use client"` directive are
     * skipped (needed for React Server Components).
     * @default false
     */
    skipServerComponents?: boolean;

    // The following are forwarded to the runtime at load time (the plugin injects
    // `window.__heapTrackerOptions` when any differ from their defaults).

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

  /**
   * Minimal Babel plugin shape. Declared locally to avoid a hard dependency on
   * `@babel/core`'s types; it is structurally assignable to Babel's `PluginItem`.
   */
  export interface BabelPlugin {
    name?: string;
    visitor: Record<string, unknown>;
  }
}

export = babelPluginHeapMarkers;
