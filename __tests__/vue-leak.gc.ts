// Real-GC leak detection for Vue, mirroring real-leak.gc.ts (React) but through
// the actual `vue` runtime. It reproduces the e2e fixture faithfully: a single
// persistent root app renders a child via a reactive toggle (like `v-if`), and
// flipping the toggle off unmounts the child. No reference to the child instance
// is held anywhere in the test, so after unmount + GC the child is collectable
// unless something in Vue (or our injected shape) retains it.
//
// The child is hand-built to match what `@vue/compiler-sfc` emits for a dev
// `<script setup>` block after our engine injects the marker: setup creates
// `_heap_`, calls track/markMounted/markUnmounted, and returns an object that
// includes `_heap_` (the compiler's `__returned__` setupState exposure).

import { createApp, h, onMounted, onUnmounted, ref } from "vue";

// Importing the runtime installs `window.__heapTracker`.
import "../packages/core/src/runtime";
import type { ReportRow } from "../packages/core/src/types";

const gc: (() => void) | undefined = (
  globalThis as typeof globalThis & { gc?: () => void }
).gc;

const tracker = () => window.__heapTracker!;

// A leaky child pushes its interval callback here so the closure (and the
// `_heap_` it captures) outlives unmount, exactly like an uncleared timer would.
const leakSink: Array<() => void> = [];

/** A `<script setup>`-shaped child component (marker injected, dev exposure). */
function makeChild(name: string, opts: { leaky: boolean }) {
  return {
    name,
    setup() {
      const _heap_ = new (function Marker() {})();
      tracker().track(_heap_, name);
      onMounted(() => {
        _heap_ && 0;
        tracker().markMounted(_heap_);
      });
      onUnmounted(() => {
        _heap_ && 0;
        tracker().markUnmounted(_heap_);
      });

      const n = ref(0);
      let id: ReturnType<typeof setInterval> | undefined;
      onMounted(() => {
        _heap_ && 0;
        const cb = () => {
          _heap_ && 0;
          n.value++;
        };
        if (opts.leaky) leakSink.push(cb);
        id = setInterval(cb, 100000);
      });
      onUnmounted(() => {
        _heap_ && 0;
        if (!opts.leaky && id) clearInterval(id);
      });

      // Dev `<script setup>` returns all top-level bindings (incl. `_heap_`).
      return { _heap_, n };
    },
    render() {
      return h("div", (this as unknown as { n: number }).n);
    },
  };
}

/**
 * Mount a persistent root app that conditionally renders `child` via a reactive
 * `show` toggle (mirrors the fixture's `v-if`). Returns `unmount()` which flips
 * the toggle off so Vue tears the child out of the root's subtree — the test
 * keeps NO reference to the child instance.
 */
function mountUnderRoot(child: object): { unmount: () => void; dispose: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const show = ref(true);
  const Root = {
    setup() {
      return () => (show.value ? h(child) : null);
    },
  };
  const app = createApp(Root);
  app.mount(container);
  return {
    unmount() {
      show.value = false;
    },
    dispose() {
      app.unmount();
      container.remove();
    },
  };
}

/** GC in cycles with a macrotask yield between each (see real-leak.gc.ts). */
async function collect(cycles = 15): Promise<ReportRow[]> {
  for (let i = 0; i < cycles; i++) {
    gc?.();
    await new Promise((r) => setTimeout(r, 15));
  }
  tracker().sweep();
  return tracker().report();
}

const inReport = (rows: ReportRow[], name: string) =>
  rows.some((r) => r.component === name);

describe("vue real-GC leak detection", () => {
  afterEach(() => {
    leakSink.length = 0;
  });

  it("collects a fixed component after unmount (absent from report)", async () => {
    const root = mountUnderRoot(makeChild("VueFixed", { leaky: false }));
    root.unmount(); // v-if → false, child torn out of the subtree
    const rows = await collect();
    root.dispose();
    expect(inReport(rows, "VueFixed")).toBe(false);
  });

  it("keeps a leaky component retained after unmount (still in report)", async () => {
    const root = mountUnderRoot(makeChild("VueLeaky", { leaky: true }));
    root.unmount();
    const rows = await collect();
    root.dispose();
    expect(inReport(rows, "VueLeaky")).toBe(true);
  });
});
