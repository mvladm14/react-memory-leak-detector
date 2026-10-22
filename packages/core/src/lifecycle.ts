// Lifecycle hooks invoked from babel-injected code.
//
// `track` is called once at component render with the marker instance. The
// `markMounted` / `markUnmounted` pair is called from a synthetic useEffect
// injected by the babel plugin. We counter-track mounts because StrictMode
// double-invokes effects (run → cleanup → run); `unmountedAt` is only set
// when the counter actually returns to zero.

import { getStats, instanceToEntry, live, registry } from "./store";
import type { LiveEntry } from "./types";

export function track(instance: object, componentName: string): void {
  const now = Date.now();
  const entry: LiveEntry = {
    ref: new WeakRef(instance),
    componentName,
    createdAt: now,
    mountCount: 0,
    unmountedAt: null,
  };
  live.add(entry);
  instanceToEntry.set(instance, entry);
  registry.register(instance, entry);

  const s = getStats(componentName);
  s.lastRegisteredAt = now;
}

export function markMounted(instance: object): void {
  const entry = instanceToEntry.get(instance);
  if (!entry) return;
  entry.mountCount += 1;
  entry.unmountedAt = null;
}

export function markUnmounted(instance: object): void {
  const entry = instanceToEntry.get(instance);
  if (!entry) return;
  if (entry.mountCount === 0) return;
  entry.mountCount -= 1;
  if (entry.mountCount === 0) entry.unmountedAt = Date.now();
}
