// React features that change when effects run or cleanups fire, through the
// full real pipeline (babel plugin → React → real GC → the runtime's sweep).
// The tracker infers "unmounted" from the injected effect's cleanup, so
// anything that runs cleanups without an unmount — or keeps an instance alive
// without its effects — is where false positives or misses would come from.
//
// Runs on whatever React is installed: CI runs it on React 17, 18 and 19. The
// <Activity> block needs React 19.2+ and is skipped on older versions; on
// 19.2+ a missing `Activity` export fails a test instead of skipping silently.
//
// React 17: when a whole root is unmounted (ReactDOM.unmountComponentAtNode,
// which is what @testing-library's unmount() does), React can keep that tree
// in memory until its next commit (seen under StrictMode and after a Suspense
// retry). A correctly cleaned-up component is then collected only after React
// renders something else. Components removed from a root that stays mounted —
// the normal case in an app — are not affected. The tests unmount roots, so on
// React 17 they commit an unrelated root first (see `afterUnmount`), and a
// React 17-only test pins the behavior.

import React from "react";
import { render, cleanup, act, waitFor } from "@testing-library/react";

import "../src/runtime";

import { installHarness, teardownHarness } from "./leak-harness";
import { compileFixture } from "./compile-fixture";
import type { LeakEvent } from "../src/types";

import { TimerLeakComponent } from "./fixtures/TimerLeakComponent";
import { TimerFixedComponent } from "./fixtures/TimerFixedComponent";
import { SuspendingComponent, makeGate } from "./fixtures/SuspendingComponent";

const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
const tracker = () => window.__heapTracker!;
const h = React.createElement;
const Activity: React.ComponentType<{ mode: "visible" | "hidden"; children?: React.ReactNode }> | undefined =
  (React as any).Activity;
const describeActivity = Activity ? describe : describe.skip;

const REACT_MAJOR = parseInt(React.version, 10);

/**
 * Run after unmounting a root, before collecting. On React 17, an unrelated
 * commit releases the tree React keeps from that unmount (see the file
 * header); on 18+ there is nothing to release, and the tests must not hide a
 * regression.
 */
function afterUnmount(): void {
  cleanup();
  if (REACT_MAJOR === 17) {
    render(h("div", null, "unrelated commit")).unmount();
    cleanup();
  }
}

/** True when the installed React is at least major.minor (canary tags ignored). */
function reactAtLeast(major: number, minor: number): boolean {
  const [maj, min] = React.version.split(".").map((n) => parseInt(n, 10));
  return maj > major || (maj === major && min >= minor);
}

/** Force collection, yielding a macrotask between cycles (see real-leak.gc.ts). */
async function forceCollect(cycles = 5): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    gc!();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Collect until `name` drops out of report() (bounded), for GC jitter. */
async function collectUntilGone(name: string): Promise<void> {
  await forceCollect();
  for (let i = 0; i < 12 && row(name); i++) await forceCollect();
}

const row = (name: string) => tracker().report().find((r) => r.component === name);

let events: LeakEvent[] = [];
let unsubscribe: () => void = () => {};
/** Sweep and return the components flagged since the last call. */
function flagged(): string[] {
  tracker().sweep();
  const names = events.map((e) => e.component);
  events = [];
  return names;
}

beforeAll(() => {
  if (typeof gc !== "function") {
    throw new Error("global.gc is unavailable — see __tests__/gc-setup.ts.");
  }
});

beforeEach(() => {
  installHarness();
  // Every unmounted-and-retained instance is stale at once; no debounce; no
  // background sweeps — only our explicit sweep()/report() calls count.
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

describe(`StrictMode (React ${React.version})`, () => {
  // StrictMode runs mount → cleanup → mount on every effect. The cleanup must
  // not leave a still-mounted instance looking unmounted.
  test("a mounted component is not flagged after StrictMode's extra cleanup", async () => {
    render(h(React.StrictMode, null, h(TimerFixedComponent)));
    await forceCollect();
    expect(flagged()).toEqual([]);
    expect(row("TimerFixedComponent")).toMatchObject({ live: 1, stale: 0 });
  });

  test("after unmount: the leak is flagged, the fixed component is collected", async () => {
    const { unmount } = render(
      h(React.StrictMode, null, h(TimerLeakComponent), h(TimerFixedComponent)),
    );
    unmount();
    afterUnmount();
    await collectUntilGone("TimerFixedComponent");
    expect(flagged()).toEqual(["TimerLeakComponent"]);
    expect(row("TimerFixedComponent")).toBeUndefined();
  });

  // README: "React 17 under StrictMode" in the compatibility notes.
  (REACT_MAJOR === 17 ? test : test.skip)(
    "KNOWN LIMITATION (React 17): after a root unmount, the tree stays in memory until React's next commit",
    async () => {
      const { unmount } = render(h(React.StrictMode, null, h(TimerFixedComponent)));
      unmount();
      cleanup();
      await forceCollect(10);
      // Unmounting the whole root: retained by React itself, so it's stale and
      // a forced GC doesn't clear it.
      expect(flagged()).toEqual(["TimerFixedComponent"]);

      // Any commit releases it.
      render(h("div", null, "unrelated commit")).unmount();
      cleanup();
      await collectUntilGone("TimerFixedComponent");
      expect(row("TimerFixedComponent")).toBeUndefined();
    },
    30_000,
  );
});

describe(`Suspense (React ${React.version})`, () => {
  test("content hidden behind a fallback keeps its effects and is not flagged", async () => {
    // A sibling suspends after mount: React hides the mounted content
    // (display: none) but keeps its passive effects, so nothing is unmounted.
    const gate = makeGate();
    const App = ({ suspend }: { suspend: boolean }) =>
      h(
        React.Suspense,
        { fallback: "loading" },
        h(TimerFixedComponent),
        suspend ? h(SuspendingComponent, { gate }) : null,
      );
    const { rerender, container, unmount } = render(h(App, { suspend: false }));
    rerender(h(App, { suspend: true }));
    expect(container.textContent).toContain("loading");

    await forceCollect();
    expect(flagged()).toEqual([]);
    expect(row("TimerFixedComponent")).toMatchObject({ live: 1, stale: 0 });

    await act(async () => {
      gate.release();
      await gate.promise;
    });
    // React 17's act() doesn't flush the retry Suspense schedules on resolve.
    await waitFor(() => expect(container.textContent).toContain("ready"));

    unmount();
    afterUnmount();
    await collectUntilGone("TimerFixedComponent");
    expect(flagged()).toEqual([]);
    expect(row("TimerFixedComponent")).toBeUndefined();
  });

  test("a component that suspends and never commits is never flagged", async () => {
    // Its render created (and tracked) a marker, but no effect ever ran, so
    // the tracker has no unmount to judge.
    const gate = makeGate();
    const { unmount } = render(
      h(React.Suspense, { fallback: "loading" }, h(SuspendingComponent, { gate })),
    );
    unmount();
    cleanup();
    await collectUntilGone("SuspendingComponent");
    expect(flagged()).toEqual([]);
    expect(row("SuspendingComponent")).toBeUndefined();
  });
});

// The gate above skips the <Activity> block when React doesn't export it. That
// is right before 19.2, but on 19.2+ it would hide a real problem (a renamed
// export, a broken install), so fail loudly there instead of skipping.
test(`<Activity> tests run on React 19.2+ (React ${React.version})`, () => {
  if (reactAtLeast(19, 2)) {
    // React exports Activity as an element-type symbol.
    expect(Activity).toBeDefined();
  }
});

describeActivity(`<Activity> (React ${React.version})`, () => {
  const App = (Child: React.ComponentType, mode: "visible" | "hidden") =>
    h(Activity!, { mode }, h(Child));

  test("KNOWN LIMITATION: a hidden component is flagged while hidden", async () => {
    // mode="hidden" runs effect cleanups but keeps the instance alive, which is
    // indistinguishable from a leak. The README documents this and the
    // `excludeUnmountTracking` workaround. If this starts failing, React
    // changed how Activity hides content: revisit the README.
    const { rerender } = render(App(TimerFixedComponent, "visible"));
    rerender(App(TimerFixedComponent, "hidden"));
    await forceCollect();
    expect(flagged()).toEqual(["TimerFixedComponent"]);

    // Shown again: effects re-run, the instance counts as mounted again.
    rerender(App(TimerFixedComponent, "visible"));
    await forceCollect();
    expect(flagged()).toEqual([]);
    expect(row("TimerFixedComponent")).toMatchObject({ live: 1, stale: 0 });
  });

  test("excludeUnmountTracking avoids the false positive", async () => {
    const { exports } = await compileFixture("TimerFixedComponent.tsx", {
      pluginOptions: { excludeUnmountTracking: [/^TimerFixedComponent$/] },
    });
    const { rerender } = render(App(exports.TimerFixedComponent, "visible"));
    rerender(App(exports.TimerFixedComponent, "hidden"));
    await forceCollect();
    expect(flagged()).toEqual([]);
    // Still tracked (and searchable as TimerFixedComponent$Heap), never stale.
    expect(row("TimerFixedComponent")).toMatchObject({ live: 1, stale: 0 });
    // Compiling the fixture loads Babel cold; give it room on a busy runner.
  }, 30_000);

  test("unmounting a hidden Activity: the leak is flagged, the fixed one is collected", async () => {
    const { rerender, unmount } = render(
      h(Activity!, { mode: "visible" }, h(TimerLeakComponent), h(TimerFixedComponent)),
    );
    rerender(h(Activity!, { mode: "hidden" }, h(TimerLeakComponent), h(TimerFixedComponent)));
    unmount();
    cleanup();
    await collectUntilGone("TimerFixedComponent");
    expect(row("TimerFixedComponent")).toBeUndefined();
    expect(flagged()).toContain("TimerLeakComponent");
  });
});
