// Live memory-leak detector runtime. Companion to ../babel-plugin.js.
//
// The babel plugin injects `var _heap_ = new (function Foo$Heap(){})()` into
// every component/hook in dev. This module wraps each marker in a WeakRef and
// a FinalizationRegistry. A marker that survives well past its render means
// some closure is still retaining it — i.e. a leak.
//
// Importing this module installs `window.__heapTracker` and starts the sweep
// loop. Intended to be loaded once at app boot in dev. See README.md.
//
// Implementation is split across:
//   - types.ts        : shared types
//   - config.ts       : runtime config + configure()
//   - store.ts        : live set, stats map, FinalizationRegistry
//   - lifecycle.ts    : track / markMounted / markUnmounted
//   - subscribers.ts  : subscribe / emitLeak (stale-leak pub-sub)
//   - sweep.ts        : sweep / report / forceGc
//
// This file is the public entry: it assembles the api, installs it on window,
// and runs the sweep loop.

import { _config, configure, onSweepIntervalChange } from "./config";
import { markMounted, markUnmounted, track } from "./lifecycle";
import { forceGc, report, sweep } from "./sweep";
import { subscribe } from "./subscribers";

export type { LeakEvent, LeakListener } from "./types";

const api = {
  track,
  markMounted,
  markUnmounted,
  sweep,
  report,
  forceGc,
  configure,
  subscribe,
};

declare global {
  interface Window {
    __heapTracker?: typeof api;
  }
}

if (typeof window !== "undefined") {
  window.__heapTracker = api;
}

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

function restartSweepLoop(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  startSweepLoop();
}

// `configure({ sweepIntervalMs: ... })` needs to restart the loop with the
// new cadence — config.ts owns the change notification, we own the loop.
onSweepIntervalChange(restartSweepLoop);

if (typeof window !== "undefined") {
  startSweepLoop();

  if (_config.logging) {
    // eslint-disable-next-line no-console
    console.info(
      "[heap-leak] tracker installed. Run window.__heapTracker.report() for a live table.",
    );
  }
}
