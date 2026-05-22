// Live memory-leak detector runtime. Companion to ../babel-plugin.js.
//
// The babel plugin injects `var _heap_ = new (function Foo$Heap(){})()` into
// every component/hook in dev. This module wraps each marker in a WeakRef and
// a FinalizationRegistry. A marker that survives well past its render means
// some closure is still retaining it — i.e. a leak.
//
// Importing this module installs `window.__heapTracker` and starts the sweep
// loop. Intended to be loaded once at app boot in dev. See README.md.

type LiveEntry = {
  ref: WeakRef<object>;
  componentName: string;
  createdAt: number;
  mountCount: number;
  unmountedAt: number | null;
};

type ComponentStats = {
  lastRegisteredAt: number;
  lastWarnedAt: number;
};

let _config = {
  logging: true,
  leakAgeMs: 10_000,
  suspectThreshold: 1,
  sweepIntervalMs: 2_000,
  warnCooldownMs: 30_000,
};

if (typeof window !== "undefined" && (window as any).__heapTrackerOptions) {
  Object.assign(_config, (window as any).__heapTrackerOptions);
}

function configure(options: Partial<typeof _config>): void {
  const oldInterval = _config.sweepIntervalMs;
  Object.assign(_config, options);
  if (options.sweepIntervalMs && options.sweepIntervalMs !== oldInterval) {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
      startSweepLoop();
    }
  }
}

const live = new Set<LiveEntry>();
const stats = new Map<string, ComponentStats>();
const instanceToEntry = new WeakMap<object, LiveEntry>();

const registry = new FinalizationRegistry<LiveEntry>((entry) => {
  live.delete(entry);
});

function getStats(name: string): ComponentStats {
  let s = stats.get(name);
  if (!s) {
    s = { lastRegisteredAt: 0, lastWarnedAt: 0 };
    stats.set(name, s);
  }
  return s;
}

function track(instance: object, componentName: string): void {
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

// Called by injected useEffect body on mount. StrictMode double-invokes the
// effect (run → cleanup → run), so we counter-track instead of just flipping
// a flag — unmountedAt is only set when the counter actually returns to 0.
function markMounted(instance: object): void {
  const entry = instanceToEntry.get(instance);
  if (!entry) return;
  entry.mountCount += 1;
  entry.unmountedAt = null;
}

function markUnmounted(instance: object): void {
  const entry = instanceToEntry.get(instance);
  if (!entry) return;
  if (entry.mountCount === 0) return;
  entry.mountCount -= 1;
  if (entry.mountCount === 0) entry.unmountedAt = Date.now();
}

function bucketLiveEntries(): Map<string, { stale: number; live: number }> {
  const now = Date.now();
  const perName = new Map<string, { stale: number; live: number }>();

  live.forEach((entry) => {
    if (!entry.ref.deref()) {
      live.delete(entry);
      return;
    }
    let bucket = perName.get(entry.componentName);
    if (!bucket) {
      bucket = { stale: 0, live: 0 };
      perName.set(entry.componentName, bucket);
    }
    bucket.live += 1;
    if (
      entry.unmountedAt != null &&
      now - entry.unmountedAt >= _config.leakAgeMs
    ) {
      bucket.stale += 1;
    }
  });

  return perName;
}

function sweep(): void {
  const now = Date.now();
  const perName = bucketLiveEntries();

  perName.forEach((bucket, name) => {
    const s = getStats(name);
    const cooldownPassed = now - s.lastWarnedAt > _config.warnCooldownMs;
    if (bucket.stale >= _config.suspectThreshold && cooldownPassed) {
      s.lastWarnedAt = now;
      if (_config.logging) {
        // eslint-disable-next-line no-console
        console.warn(
          `[heap-leak] Suspected leak: ${name} — ${bucket.stale} instance(s) unmounted >${_config.leakAgeMs / 1000}s ago still retained (live ${bucket.live} total)`,
        );
      }
    }
  });
}

type ReportRow = {
  component: string;
  live: number;
  stale: number;
  lastRenderSecsAgo: number;
};

function report(): ReportRow[] {
  const now = Date.now();
  const perName = bucketLiveEntries();
  const rows: ReportRow[] = [];

  perName.forEach((bucket, name) => {
    const s = getStats(name);
    rows.push({
      component: name,
      live: bucket.live,
      stale: bucket.stale,
      lastRenderSecsAgo: Number(((now - s.lastRegisteredAt) / 1000).toFixed(1)),
    });
  });

  rows.sort((a, b) => b.stale - a.stale || b.live - a.live);

  if (_config.logging) {
    // eslint-disable-next-line no-console
    console.table(rows);
  }
  return rows;
}

function forceGc(): void {
  const w = window as typeof window & { gc?: () => void };
  if (typeof w.gc === "function") {
    w.gc();
    if (_config.logging) {
      // eslint-disable-next-line no-console
      console.info("[heap-leak] window.gc() invoked; re-sweeping.");
    }
  } else {
    if (_config.logging) {
      // eslint-disable-next-line no-console
      console.info(
        '[heap-leak] window.gc not available. Start Chrome with --js-flags="--expose-gc" to enable.',
      );
    }
  }
  sweep();
}

const api = {
  track,
  markMounted,
  markUnmounted,
  sweep,
  report,
  forceGc,
  configure,
};

declare global {
  interface Window {
    __heapTracker?: typeof api;
  }
}

if (typeof window !== "undefined") {
  window.__heapTracker = api;
}

export {};

let intervalId: ReturnType<typeof setInterval> | null = null;
function startSweepLoop(): void {
  if (typeof document === "undefined") return;
  if (intervalId !== null) return;
  intervalId = setInterval(() => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "visible"
    )
      sweep();
  }, _config.sweepIntervalMs);
}

if (typeof window !== "undefined") {
  startSweepLoop();

  if (_config.logging) {
    // eslint-disable-next-line no-console
    console.info(
      "[heap-leak] tracker installed. Run window.__heapTracker.report() for a live table.",
    );
  }
}
