// Shared types for the runtime tracker. Companion to ../babel-plugin.js.

export type LiveEntry = {
  ref: WeakRef<object>;
  componentName: string;
  createdAt: number;
  mountCount: number;
  unmountedAt: number | null;
  /**
   * Set while the instance is stale (see witness.ts). Its object being gone
   * means a major collection has run since the instance went stale.
   */
  witness: Witness | null;
};

/** A released old-generation object, shared by the instances that went stale in one job. */
export type Witness = { ref: WeakRef<object> };

export type ComponentStats = {
  lastRegisteredAt: number;
  lastWarnedAt: number;
};

export type LeakEvent = {
  /** Component / hook name (matches `ComponentName` in the `ComponentName$Heap` heap-snapshot marker). */
  component: string;
  /**
   * Number of instances unmounted ≥ leakAgeMs ago that are still reachable
   * after a garbage collection that ran once they had been unmounted that long.
   */
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
  /** Unmounted ≥ leakAgeMs ago and still in memory after a garbage collection: leaked. */
  stale: number;
  /**
   * Unmounted ≥ leakAgeMs ago but no garbage collection has run since: they
   * may just not have been collected yet, so they aren't reported.
   */
  awaitingGc: number;
  lastRenderSecsAgo: number;
};

export type HeapTrackerOptions = {
  logging: boolean;
  leakAgeMs: number;
  suspectThreshold: number;
  sweepIntervalMs: number;
  warnCooldownMs: number;
};
