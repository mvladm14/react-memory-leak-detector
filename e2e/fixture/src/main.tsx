import React from "react";
import { createRoot } from "react-dom/client";
// Importing the runtime installs `window.__heapTracker` and starts tracking.
// `window.__heapTrackerOptions` was already set by the inline script in
// index.html, so the runtime picks up the deterministic e2e config on install.
import "react-memory-leak-detector/runtime";
import { App } from "./App";

// Deterministic test hooks for Playwright. `collect()` forces GC in cycles —
// a WeakRef target can't be reclaimed within the same macrotask it was last
// observed, so we yield between collections (mirrors real-leak.gc.ts) — then
// returns the tracker's view plus any leak events captured since load.
declare global {
  interface Window {
    __leakTest?: {
      events: unknown[];
      collect(cycles?: number): Promise<{ events: unknown[]; report: unknown[] }>;
    };
  }
}

const events: unknown[] = [];
window.__heapTracker?.subscribe((event) => events.push(event));

window.__leakTest = {
  events,
  async collect(cycles = 8) {
    for (let i = 0; i < cycles; i++) {
      window.__heapTracker?.forceGc(); // window.gc() (needs --expose-gc) + sweep()
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    return { events: events.slice(), report: window.__heapTracker?.report() ?? [] };
  },
};

createRoot(document.getElementById("root")!).render(<App />);
