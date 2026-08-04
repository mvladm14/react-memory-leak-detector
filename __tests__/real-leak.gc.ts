// End-to-end leak detection through the FULL real pipeline:
//
//   real component source ──(babel-plugin.js)──▶ instrumented code
//        rendered/unmounted via React + @testing-library/react
//        real WeakRef + FinalizationRegistry + real garbage collection
//        the runtime's own track / sweep / report
//
// Unlike the unit suites (which stand in plain `{}` objects for components and
// fake staleness by backdating `unmountedAt`), this proves the actual behaviour
// for each classic leak culprit — and that its idiomatic fix is collected:
//
//   culprit                  leaks when…                 fixed by…
//   ─────────────────────────────────────────────────────────────────────────
//   setInterval              never cleared               clearInterval on unmount
//   setTimeout               never cleared (pending)     clearTimeout on unmount
//   event listener           never removed               removeEventListener
//   requestAnimationFrame    loop never cancelled        cancelAnimationFrame
//   promise (fetch)          never settled/aborted       AbortController.abort()
//   closure / subscriber     pushed and never removed    remove from the list
//
// This is the "gc" jest project (see jest.config.js) and runs as part of the
// normal `npm test`. A real V8 gc() is exposed for it by __tests__/gc-setup.ts
// (via the v8/vm trick, so no --expose-gc CLI flag is needed and the unit
// suites — which assert window.gc is absent — are unaffected).

import React from "react";
import { render, cleanup } from "@testing-library/react";

// Importing the runtime installs `window.__heapTracker`, which the
// babel-injected fixture code calls into.
import "../src/runtime";

import { installHarness, teardownHarness } from "./leak-harness";
import type { LeakEvent, ReportRow } from "../src/types";

import { CleanComponent } from "./fixtures/CleanComponent";
import { ClosureLeakComponent } from "./fixtures/ClosureLeakComponent";
import { TimerLeakComponent } from "./fixtures/TimerLeakComponent";
import { TimerFixedComponent } from "./fixtures/TimerFixedComponent";
import { TimeoutLeakComponent } from "./fixtures/TimeoutLeakComponent";
import { TimeoutFixedComponent } from "./fixtures/TimeoutFixedComponent";
import { ListenerLeakComponent } from "./fixtures/ListenerLeakComponent";
import { ListenerFixedComponent } from "./fixtures/ListenerFixedComponent";
import { RafLeakComponent } from "./fixtures/RafLeakComponent";
import { RafFixedComponent } from "./fixtures/RafFixedComponent";
import { PromiseLeakComponent } from "./fixtures/PromiseLeakComponent";
import { PromiseFixedComponent } from "./fixtures/PromiseFixedComponent";

const gc: (() => void) | undefined = (
  globalThis as typeof globalThis & { gc?: () => void }
).gc;

const tracker = () => window.__heapTracker!;

/**
 * Force collection. The macrotask yield between cycles is essential: a WeakRef
 * won't be cleared within the same turn its target was last observed, so we
 * must return to the event loop before asking V8 to collect again.
 */
async function forceCollect(cycles = 5): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    gc!();
    // setTimeout (not setImmediate, which jsdom doesn't expose) yields to a new
    // macrotask — required before a WeakRef target can be reclaimed.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// Render + unmount inside an isolated scope so no test-local variable keeps the
// render result (and therefore the fiber / marker) reachable across the GC.
function mountThenUnmount(element: React.ReactElement): void {
  const { unmount } = render(element);
  unmount();
}

/**
 * Mount a component, unmount it, force GC, then return the tracker's view.
 *
 * When `expectCollected` is true we poll (GC is non-deterministic, so give it a
 * few chances to reclaim the marker before we look). Any leak events fired
 * during the run are captured for the caller to assert on.
 */
async function observeAfterUnmount(
  element: React.ReactElement,
  componentName: string,
  expectCollected: boolean,
): Promise<{ rows: ReportRow[]; events: LeakEvent[] }> {
  const events: LeakEvent[] = [];
  const unsubscribe = tracker().subscribe((event) => events.push(event));

  mountThenUnmount(element);
  cleanup(); // drop @testing-library's container ref before collecting

  await forceCollect();
  if (expectCollected) {
    // Once collected, the entry drops out of `live`, so report() stops listing
    // it. Retry a bounded number of times to absorb GC timing jitter.
    let rows = tracker().report();
    for (
      let i = 0;
      i < 12 && rows.some((r) => r.component === componentName);
      i++
    ) {
      await forceCollect();
      rows = tracker().report();
    }
  }

  tracker().sweep();
  unsubscribe();
  return { rows: tracker().report(), events };
}

/** Assert the component's marker was reclaimed and no leak fired for it. */
async function expectCollected(
  Component: React.ComponentType,
  name: string,
): Promise<void> {
  const { rows, events } = await observeAfterUnmount(
    React.createElement(Component),
    name,
    true,
  );
  expect(rows.find((r) => r.component === name)).toBeUndefined();
  expect(events.some((e) => e.component === name)).toBe(false);
}

/** Assert the component's marker survived GC and sweep() flagged it. */
async function expectLeaked(
  Component: React.ComponentType,
  name: string,
): Promise<void> {
  const { rows, events } = await observeAfterUnmount(
    React.createElement(Component),
    name,
    false,
  );
  const row = rows.find((r) => r.component === name);
  expect(row).toBeDefined();
  expect(row!.stale).toBeGreaterThanOrEqual(1);
  expect(events.some((e) => e.component === name)).toBe(true);
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
  // Deterministic sweeps: any retained-and-unmounted entry is immediately
  // "stale", no cooldown, and the background loop is pushed far into the future
  // so only our explicit sweep()/report() calls matter.
  tracker().configure({
    leakAgeMs: 0,
    suspectThreshold: 1,
    warnCooldownMs: 0,
    sweepIntervalMs: 1_000_000_000,
    logging: false,
  });
});

afterEach(() => {
  cleanup();
  teardownHarness();
});

describe("real React component leak detection (WeakRef + real GC)", () => {
  test("baseline: a component that registers nothing is collected", async () => {
    await expectCollected(CleanComponent, "CleanComponent");
  });

  // Each classic culprit: the leaky version survives GC and is flagged; the
  // idiomatic fix is reclaimed and stays silent (guards against false positives).
  describe.each([
    {
      culprit: "setInterval",
      leak: TimerLeakComponent,
      leakName: "TimerLeakComponent",
      fixed: TimerFixedComponent,
      fixedName: "TimerFixedComponent",
    },
    {
      culprit: "setTimeout",
      leak: TimeoutLeakComponent,
      leakName: "TimeoutLeakComponent",
      fixed: TimeoutFixedComponent,
      fixedName: "TimeoutFixedComponent",
    },
    {
      culprit: "event listener",
      leak: ListenerLeakComponent,
      leakName: "ListenerLeakComponent",
      fixed: ListenerFixedComponent,
      fixedName: "ListenerFixedComponent",
    },
    {
      culprit: "requestAnimationFrame",
      leak: RafLeakComponent,
      leakName: "RafLeakComponent",
      fixed: RafFixedComponent,
      fixedName: "RafFixedComponent",
    },
    {
      culprit: "promise (fetch)",
      leak: PromiseLeakComponent,
      leakName: "PromiseLeakComponent",
      fixed: PromiseFixedComponent,
      fixedName: "PromiseFixedComponent",
    },
  ])("$culprit", ({ leak, leakName, fixed, fixedName }) => {
    test("leaks when not cleaned up", async () => {
      await expectLeaked(leak, leakName);
    });

    test("is collected when cleaned up", async () => {
      await expectCollected(fixed, fixedName);
    });
  });

  // The original generic example: a closure pushed onto a never-cleared
  // subscriber list (the shape underlying most of the culprits above).
  test("closure/subscriber: retained on a never-cleared list, leaks", async () => {
    await expectLeaked(ClosureLeakComponent, "ClosureLeakComponent");
  });
});
