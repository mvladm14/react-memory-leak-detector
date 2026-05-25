// Module-level state for the runtime tracker.
//
// - `live`           : every tracked entry whose marker is still reachable in JS.
// - `stats`          : per-component-name counters (last-render time, last-warn time).
// - `instanceToEntry`: lookup from marker instance back to its entry, used by
//                      `markMounted` / `markUnmounted` from the injected useEffect.
// - `registry`       : when a marker is GC'd, drop its entry from `live`.

import type { ComponentStats, LiveEntry } from "./types";

export const live = new Set<LiveEntry>();
export const stats = new Map<string, ComponentStats>();
export const instanceToEntry = new WeakMap<object, LiveEntry>();

export const registry = new FinalizationRegistry<LiveEntry>((entry) => {
  live.delete(entry);
});

export function getStats(name: string): ComponentStats {
  let s = stats.get(name);
  if (!s) {
    s = { lastRegisteredAt: 0, lastWarnedAt: 0 };
    stats.set(name, s);
  }
  return s;
}
