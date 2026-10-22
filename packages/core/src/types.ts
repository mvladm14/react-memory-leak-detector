// Shared types for the runtime tracker. Companion to ../babel-plugin.js.

export type LiveEntry = {
  ref: WeakRef<object>;
  componentName: string;
  createdAt: number;
  mountCount: number;
  unmountedAt: number | null;
};

export type ComponentStats = {
  lastRegisteredAt: number;
  lastWarnedAt: number;
};

export type LeakEvent = {
  /** Component / hook name (matches `ComponentName` in the `ComponentName$Heap` heap-snapshot marker). */
  component: string;
  /** Number of instances unmounted ≥ leakAgeMs ago that are still reachable. */
  stale: number;
  /** Total live (reachable) instances, including mounted + recently-unmounted + leaked. */
  live: number;
  /** Threshold (ms) used to classify an unmounted instance as stale. */
  leakAgeMs: number;
  /** Timestamp (ms since epoch) at which the event was fired. */
  at: number;
};

export type LeakListener = (event: LeakEvent) => void;

export type ReportRow = {
  component: string;
  live: number;
  stale: number;
  lastRenderSecsAgo: number;
};

export type HeapTrackerOptions = {
  logging: boolean;
  leakAgeMs: number;
  suspectThreshold: number;
  sweepIntervalMs: number;
  warnCooldownMs: number;
};
