// Pub/sub for stale-leak events. Listeners only fire from the sweep loop when
// a component's stale count crosses `suspectThreshold` and the per-component
// `warnCooldownMs` has elapsed — same gating as the console warning.

import { _config } from "./config";
import type { LeakEvent, LeakListener } from "./types";

const listeners = new Set<LeakListener>();

export function subscribe(listener: LeakListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function hasListeners(): boolean {
  return listeners.size > 0;
}

export function emitLeak(event: LeakEvent): void {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (err) {
      if (_config.logging) {
        // eslint-disable-next-line no-console
        console.error("[heap-leak] listener threw:", err);
      }
    }
  });
}
