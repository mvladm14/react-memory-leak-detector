// Garbage-collection lag, through the full real pipeline (babel plugin →
// React → real WeakRef / FinalizationRegistry → the runtime's sweep).
//
// A component that cleaned up correctly stays in memory until the engine
// collects garbage. Being in memory `leakAgeMs` after unmount is therefore
// not enough to report it: the runtime must wait for a collection that ran
// after the instance went stale, and report only what survived it (see
// src/witness.ts). The unit suites check the bookkeeping with a simulated
// collection; this suite checks it against real ones.
//
// Node's scavenges never clear WeakRefs, so the runtime's reliance on major
// collections only can't be checked here. Chromium's can, and
// e2e/playwright/gc-during-unmount.spec.ts checks it there.

import React from "react";
import { render, cleanup } from "@testing-library/react";

import "../src/runtime";

import { installHarness, teardownHarness } from "./leak-harness";
import type { LeakEvent } from "../src/types";

import { TimerLeakComponent } from "./fixtures/TimerLeakComponent";
import { TimerFixedComponent } from "./fixtures/TimerFixedComponent";

const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
const tracker = () => window.__heapTracker!;
const h = React.createElement;

/** Force collection, yielding a macrotask between cycles (see real-leak.gc.ts). */
async function forceCollect(cycles = 5): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    gc!();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const row = (name: string) => tracker().report().find((r) => r.component === name);

let events: LeakEvent[] = [];
let unsubscribe: () => void = () => {};
/** Sweep and return the components flagged since the last call. */
function flagged(): string[] {
  tracker().sweep();
  const names = events.map((e) => e.component).sort();
  events = [];
  return names;
}

/**
 * Render and unmount in a scope of its own, so nothing here retains it. On
 * React 17 an unrelated commit follows: after a root unmount, React 17 keeps
 * that tree until its next commit (README; see react-features.gc.ts).
 */
function mountThenUnmount(element: React.ReactElement): void {
  render(element).unmount();
  cleanup();
  if (parseInt(React.version, 10) === 17) {
    render(h("div", null, "unrelated commit")).unmount();
    cleanup();
  }
}

beforeAll(() => {
  if (typeof gc !== "function") {
    throw new Error("global.gc is unavailable — see __tests__/gc-setup.ts.");
  }
});

beforeEach(() => {
  installHarness();
  tracker().configure({
    leakAgeMs: 0,
    suspectThreshold: 1,
    warnCooldownMs: 0,
    sweepIntervalMs: 1_000_000_000,
    logging: false,
  });
  events = [];
  unsubscribe = tracker().subscribe((e) => events.push(e));
});

afterEach(() => {
  unsubscribe();
  cleanup();
  teardownHarness();
});

test("before any collection, nothing still in memory is reported; after one, only the leak is", async () => {
  mountThenUnmount(h("div", null, h(TimerFixedComponent), h(TimerLeakComponent)));
  // A macrotask later, as the background sweep would run. No gc() yet.
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Scenario guard: the fixed component really is still in memory, so it
  // would have been reported by a runtime that doesn't wait for a collection.
  expect(row("TimerFixedComponent")).toMatchObject({ live: 1, stale: 0, awaitingGc: 1 });
  expect(row("TimerLeakComponent")).toMatchObject({ live: 1, stale: 0, awaitingGc: 1 });
  expect(flagged()).toEqual([]);

  await forceCollect();
  expect(flagged()).toEqual(["TimerLeakComponent"]);
  expect(row("TimerFixedComponent")).toBeUndefined();
  expect(row("TimerLeakComponent")).toMatchObject({ live: 1, stale: 1, awaitingGc: 0 });
});

test("a collection that ran before the instance went stale does not count", async () => {
  tracker().configure({ leakAgeMs: 60_000 });
  mountThenUnmount(h(TimerLeakComponent));

  // Collections within leakAgeMs of the unmount: the leak survives them, but
  // it isn't stale yet, so they don't count towards the verdict.
  await forceCollect();
  expect(flagged()).toEqual([]);
  expect(row("TimerLeakComponent")).toMatchObject({ stale: 0, awaitingGc: 0 });

  // leakAgeMs passes (lowered rather than waited out, so the collections above
  // can't take long enough to make it stale early). No collection since.
  tracker().configure({ leakAgeMs: 0 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(flagged()).toEqual([]);
  expect(row("TimerLeakComponent")).toMatchObject({ stale: 0, awaitingGc: 1 });

  await forceCollect();
  expect(flagged()).toEqual(["TimerLeakComponent"]);
});
