// Importing the runtime installs `window.__heapTracker` and starts tracking.
// `window.__heapTrackerOptions` was already set by the inline script in
// index.html, so the runtime picks up the deterministic e2e config on install.
import "@memleak/core/runtime";
import { createApp } from "vue";
import App from "./App.vue";

// Deterministic test hooks for Playwright, identical to the React fixture's
// (see ../fixture/src/main.tsx) so the same leak.spec.ts drives both.
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

createApp(App).mount("#app");
