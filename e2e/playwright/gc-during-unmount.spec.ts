import { expect, test } from "@playwright/test";

// Garbage collections around an unmount, with leakAgeMs 0 (index.html), in
// Chromium with --expose-gc so the collections can be placed exactly.
//
// The runtime reports an instance when a "witness" released once it went
// stale is gone but its marker is still in memory (src/witness.ts). With
// leakAgeMs 0 the witness is released in markUnmounted, called from the
// injected effect cleanup while React is still tearing the component down.
// Two things can go wrong there:
//
//  - A collection during the teardown finds the marker still referenced. It
//    must not free the witness either. The WeakRef created at release keeps
//    the witness alive until the end of the job.
//  - A minor collection (scavenge) after the teardown. A cleaned-up
//    component's marker survives every scavenge until the next major
//    collection: dead DOM-side records (a cleared timer, a removed listener)
//    still point at its callbacks, and a scavenge treats them as live. A
//    young witness would be freed alone, which is why witnesses are old-
//    generation objects that only a major collection can free.
//
// Each case forces collections at one point, then sweeps without any further
// collection: no fixed component may be reported.

const COMBO = `plugin-react ${process.env.PLUGIN_REACT || "v6"} / engine ${
  process.env.HEAP_ENGINE || "auto"
} / React ${process.env.REACT || "18"}${process.env.COMPILER ? " + compiler" : ""}`;

const FIXED = [
  ["toggle-fixed", "fixed", "FixedTimer"],
  ["toggle-fixed-raf", "fixed-raf", "FixedAnimationFrame"],
  ["toggle-fixed-listeners", "fixed-listeners", "FixedListeners"],
  ["toggle-fixed-promise", "fixed-promise", "FixedPromise"],
] as const;
const LEAKY = ["toggle-leaky", "leaky", "LeakyTimer"] as const;

type ReportRow = { component: string; live: number; stale: number; awaitingGc?: number };
type LeakEvent = { component: string };
type Tracker = {
  report(): ReportRow[];
  sweep(): void;
  markUnmounted(instance: object): void;
};
type PageGlobals = {
  __heapTracker?: Tracker;
  __leakTest?: { events: LeakEvent[]; collect(cycles?: number): Promise<{ events: LeakEvent[]; report: ReportRow[] }> };
  gc: (options?: { type: "minor" | "major" }) => void;
};

// When the collection runs, relative to the release in markUnmounted:
//   sync       synchronously, right after it, while React is mid-teardown
//   microtask  in a microtask: the end of the same job
//   next-task  in the next task, after the teardown
// and which kind: a minor collection (scavenge, frees young objects only), a
// major one, or both. "aged" promotes the markers first.
const CASES = [
  { when: "sync", kind: "minor", aged: false },
  { when: "sync", kind: "major", aged: false },
  { when: "sync", kind: "major", aged: true },
  { when: "sync", kind: "minor+major", aged: false },
  { when: "microtask", kind: "minor", aged: false },
  { when: "microtask", kind: "major", aged: false },
  { when: "next-task", kind: "minor", aged: false },
  { when: "next-task", kind: "major", aged: false },
] as const;

for (const c of CASES) {
  const label = `${c.kind}${c.aged ? " (aged)" : ""}, ${c.when}`;
  test(`a collection at unmount (${label}) doesn't get a cleaned-up component reported — ${COMBO}`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForFunction(() => {
      const w = window as unknown as PageGlobals;
      return !!w.__heapTracker && !!w.__leakTest;
    });

    for (const [toggle, testId] of [...FIXED, LEAKY]) {
      await page.getByTestId(toggle).click();
      await expect(page.getByTestId(testId)).toBeVisible();
    }

    const result = await page.evaluate(
      async ({ c, toggles }) => {
        const w = window as unknown as PageGlobals;
        const tracker = w.__heapTracker!;
        const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

        if (c.aged) {
          for (let i = 0; i < 4; i++) {
            await macrotask();
            w.gc({ type: "minor" });
          }
          await macrotask();
        }

        // Collect right after each release (or a microtask / a task later).
        let collectionsInsideUnmount = 0;
        const collect = () => {
          if (c.kind.includes("minor")) w.gc({ type: "minor" });
          if (c.kind.includes("major")) w.gc({ type: "major" });
          collectionsInsideUnmount += 1;
        };
        const original = tracker.markUnmounted;
        tracker.markUnmounted = (instance: object) => {
          original(instance);
          if (c.when === "sync") collect();
          else if (c.when === "microtask") queueMicrotask(collect);
          else setTimeout(collect, 0);
        };
        try {
          // Unmount everything from inside the page, so no collection the
          // test didn't ask for has time to run in between.
          for (const toggle of toggles) {
            (document.querySelector(`[data-testid="${toggle}"]`) as HTMLElement).click();
          }
          // React 17's legacy root flushes passive effects (the cleanups) in
          // a later task; give every React version time to finish.
          for (let i = 0; i < 5 && collectionsInsideUnmount < toggles.length; i++) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        } finally {
          tracker.markUnmounted = original;
        }

        // No collection since the ones inside the unmount. A fixed component
        // may still be in memory (awaiting GC), but must not be reported.
        await macrotask();
        tracker.sweep();
        const afterSweep = {
          events: w.__leakTest!.events.map((e) => e.component),
          report: tracker.report(),
        };

        // Real collections afterwards: the fixed components go, the leak is reported.
        const { events, report } = await w.__leakTest!.collect(15);
        return {
          collectionsInsideUnmount,
          afterSweep,
          final: { events: events.map((e) => e.component), report },
        };
      },
      { c, toggles: [...FIXED, LEAKY].map(([toggle]) => toggle) },
    );

    // Scenario guard: every unmount really ran the forced collection.
    expect(result.collectionsInsideUnmount, `collections inside the unmount (${COMBO})`).toBe(
      FIXED.length + 1,
    );
    for (const [, , name] of FIXED) {
      expect(
        result.afterSweep.events.includes(name),
        `${name} must not be reported after a ${label} collection at its unmount (${COMBO}); ` +
          `report: ${JSON.stringify(result.afterSweep.report)}`,
      ).toBe(false);
      expect(result.final.events.includes(name), `${name} must never be reported (${COMBO})`).toBe(false);
      expect(
        result.final.report.find((r) => r.component === name),
        `${name} must be collected (${COMBO})`,
      ).toBeUndefined();
    }
    expect(result.final.events.includes(LEAKY[2]), `${LEAKY[2]} must be reported (${COMBO})`).toBe(true);
  });
}
