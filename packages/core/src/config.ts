// Runtime configuration. Mutable so that `configure()` can hot-update behavior
// (e.g. logging, thresholds, sweep cadence) without re-importing the module.

import type { HeapTrackerOptions } from "./types";

export const _config: HeapTrackerOptions = {
  logging: true,
  leakAgeMs: 10_000,
  suspectThreshold: 1,
  sweepIntervalMs: 2_000,
  warnCooldownMs: 30_000,
};

// Allow `window.__heapTrackerOptions = { ... }` to be set before this module
// loads, so users can configure the tracker without a code import order step.
if (typeof window !== "undefined" && (window as any).__heapTrackerOptions) {
  Object.assign(_config, (window as any).__heapTrackerOptions);
}

const intervalChangeListeners = new Set<() => void>();

/**
 * Register a callback that fires when `configure()` changes `sweepIntervalMs`.
 * Used by the sweep loop to restart itself with the new cadence.
 */
export function onSweepIntervalChange(cb: () => void): void {
  intervalChangeListeners.add(cb);
}

export function configure(options: Partial<HeapTrackerOptions>): void {
  const oldInterval = _config.sweepIntervalMs;
  Object.assign(_config, options);
  if (options.sweepIntervalMs && options.sweepIntervalMs !== oldInterval) {
    intervalChangeListeners.forEach((cb) => cb());
  }
}
