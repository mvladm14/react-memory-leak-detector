// Lifecycle hooks invoked from babel-injected code.
//
// `track` is called once at component render with the marker instance. The
// `markMounted` / `markUnmounted` pair is called from a synthetic useEffect
// injected by the babel plugin. We counter-track mounts because StrictMode
// double-invokes effects (run → cleanup → run); `unmountedAt` is only set
// when the counter actually returns to zero.
//
// Late adoption: the runtime is usually loaded with a fire-and-forget dynamic
// `import()` that resolves AFTER React's first render and commit. Every
// component in the initial tree therefore calls `track()` while
// `window.__heapTracker` is still absent, and the injected code never retries
// (the marker lives in a useRef). To avoid losing the app shell, layouts and
// the landing route for good, `markMounted` / `markUnmounted` adopt a marker
// they have never seen: the component name is recovered from the marker's
// constructor (`ComponentName$Heap`), the instance is tracked, and the
// mount/unmount is then applied normally.

import { getStats, instanceToEntry, live, registry } from "./store";
import type { LiveEntry } from "./types";

const MARKER_SUFFIX = "$Heap";

function register(instance: object, componentName: string): LiveEntry {
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
  return entry;
}

export function track(instance: object, componentName: string): void {
  register(instance, componentName);
}

/**
 * Recover the component name from a marker created by the babel plugin:
 * `new (function ComponentName$Heap() {})()`. Falls back to "Unknown" when
 * the instance has no named constructor.
 */
export function componentNameOf(instance: object): string {
  const ctor = (instance as { constructor?: unknown }).constructor;
  const raw = typeof ctor === "function" ? ctor.name : "";
  if (!raw) return "Unknown";
  return raw.endsWith(MARKER_SUFFIX)
    ? raw.slice(0, -MARKER_SUFFIX.length)
    : raw;
}

/** Track an instance that rendered before the runtime was installed. */
function adopt(instance: object): LiveEntry {
  return register(instance, componentNameOf(instance));
}

export function markMounted(instance: object): void {
  const entry = instanceToEntry.get(instance) ?? adopt(instance);
  entry.mountCount += 1;
  entry.unmountedAt = null;
}

export function markUnmounted(instance: object): void {
  const entry = instanceToEntry.get(instance);
  if (!entry) {
    // First sighting is the unmount itself: the mount happened before the
    // runtime loaded. Adopt it as already-unmounted so the sweep can judge it.
    adopt(instance).unmountedAt = Date.now();
    return;
  }
  if (entry.mountCount === 0) return;
  entry.mountCount -= 1;
  if (entry.mountCount === 0) entry.unmountedAt = Date.now();
}
