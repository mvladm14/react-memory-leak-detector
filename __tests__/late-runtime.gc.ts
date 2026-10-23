// Late-loaded runtime, through the FULL real pipeline (same recipe as
// real-leak.gc.ts: babel-plugin.js instruments the fixtures, React renders them,
// a real GC runs, the runtime's own sweep / report judge the result).
//
// The README installs the runtime with a fire-and-forget dynamic `import()`,
// which resolves after React's first render and commit. Every component in the
// initial tree therefore calls `track()` while `window.__heapTracker` is still
// absent, and the injected code never retries. This suite renders the fixtures
// FIRST, imports the runtime SECOND, and proves that:
//
//   - a leaky component mounted before the runtime loaded is still adopted on
//     unmount (name recovered from its `Name$Heap` marker) and flagged;
//   - a clean component mounted before the runtime loaded is adopted, then
//     collected, and never flagged (false-positive guard).
//
// NOTE: no static `import "../src/runtime"` here — that is the whole point.

import React from "react";
import { render, cleanup } from "@testing-library/react";

import { installHarness, teardownHarness } from "./leak-harness";
import type { LeakEvent, ReportRow } from "../src/types";

import { CleanComponent } from "./fixtures/CleanComponent";
import { TimerLeakComponent } from "./fixtures/TimerLeakComponent";

const gc: (() => void) | undefined = (
  globalThis as typeof globalThis & { gc?: () => void }
).gc;

const tracker = () => window.__heapTracker!;

/** Force collection with a macrotask yield between cycles (see real-leak.gc.ts). */
async function forceCollect(cycles = 5): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    gc!();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeAll(() => {
  if (typeof gc !== "function") {
    throw new Error(
      "global.gc is unavailable — __tests__/gc-setup.ts (the gc project's " +
        "setupFiles) is expected to expose it.",
    );
  }
});

beforeEach(() => {
  installHarness();
});

afterEach(() => {
  cleanup();
  teardownHarness();
});

describe("components rendered before the runtime loads", () => {
  test("are adopted on unmount: the leaky one is flagged, the clean one is collected", async () => {
    // ── 1) Render while the tracker is absent (the README's dynamic-import gap).
    expect(window.__heapTracker).toBeUndefined();
    const leaky = render(React.createElement(TimerLeakComponent));
    const clean = render(React.createElement(CleanComponent));

    // ── 2) The runtime arrives late. Nothing has been tracked yet.
    const runtime = await import("../src/runtime");
    void runtime;
    expect(window.__heapTracker).toBeDefined();
    tracker().configure({
      leakAgeMs: 0,
      suspectThreshold: 1,
      warnCooldownMs: 0,
      sweepIntervalMs: 1_000_000_000,
      logging: false,
    });
    expect(tracker().report()).toEqual([]);

    const events: LeakEvent[] = [];
    const unsubscribe = tracker().subscribe((event) => events.push(event));

    // ── 3) Unmount: the injected cleanup calls markUnmounted on markers the
    // runtime has never seen. They are adopted (name from `Name$Heap`) and
    // recorded as already unmounted, so a sweep can judge them.
    leaky.unmount();
    clean.unmount();
    cleanup();

    const adopted = tracker()
      .report()
      .map((r) => r.component)
      .sort();
    expect(adopted).toEqual(["CleanComponent", "TimerLeakComponent"]);

    // ── 4) Real GC. The uncleared interval retains the leaky marker; the clean
    // marker has no retainer and drops out of the live set once collected.
    await forceCollect();
    let rows: ReportRow[] = tracker().report();
    for (
      let i = 0;
      i < 12 && rows.some((r) => r.component === "CleanComponent");
      i++
    ) {
      await forceCollect();
      rows = tracker().report();
    }
    tracker().sweep();
    unsubscribe();
    rows = tracker().report();

    const leakyRow = rows.find((r) => r.component === "TimerLeakComponent");
    expect(leakyRow).toBeDefined();
    expect(leakyRow!.live).toBe(1);
    expect(leakyRow!.stale).toBe(1);
    expect(events.some((e) => e.component === "TimerLeakComponent")).toBe(true);

    expect(rows.find((r) => r.component === "CleanComponent")).toBeUndefined();
    expect(events.some((e) => e.component === "CleanComponent")).toBe(false);
  });
});
