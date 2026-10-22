// Sweep, report, and forced-GC entry points.
//
// `bucketLiveEntries` walks the live set, drops GC'd entries, and tallies
// stale-vs-live counts per component name. It's shared between `sweep` (which
// fires warnings + listener events) and `report` (which returns a snapshot).

import { _config } from "./config";
import { getStats, live } from "./store";
import { emitLeak, hasListeners } from "./subscribers";
import type { ReportRow } from "./types";

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

export function sweep(): void {
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
      if (hasListeners()) {
        emitLeak({
          component: name,
          stale: bucket.stale,
          live: bucket.live,
          leakAgeMs: _config.leakAgeMs,
          at: now,
        });
      }
    }
  });
}

export function report(): ReportRow[] {
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

export function forceGc(): void {
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
