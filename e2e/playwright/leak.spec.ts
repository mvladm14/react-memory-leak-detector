import { expect, test } from "@playwright/test";

// Labels the run with the matrix combo under test (set by run.mjs).
const COMBO = `plugin-react ${process.env.PLUGIN_REACT || "v6"} / engine ${
  process.env.HEAP_ENGINE || "auto"
} / React ${process.env.REACT || "18"}${process.env.COMPILER ? " + compiler" : ""}`;

// Shapes of the window hooks the fixture installs (see fixture/src/main.tsx).
type LeakEvent = { component: string; stale: number; live: number };
type ReportRow = { component: string; live: number; stale: number };
declare global {
  interface Window {
    __heapTracker?: {
      report(): ReportRow[];
      forceGc(): void;
    };
    __leakTest?: {
      events: LeakEvent[];
      trackerAtRender?: boolean;
      reactVersion?: string;
      collect(
        cycles?: number,
      ): Promise<{ events: LeakEvent[]; report: ReportRow[] }>;
    };
  }
}

test.describe(`live leak detection — ${COMBO}`, () => {
  // Scenario guards: the combo really runs the React it claims and the app
  // really renders on it, and with COMPILER=1 the components really are
  // compiled. Rendering is checked here because a broken mount (e.g. React 17
  // given the createRoot entry instead of src/mount-legacy.tsx) still installs
  // the test hooks; without this check it would surface only as every later
  // test timing out. The React Compiler skips a function silently when it
  // can't compile it (our injected code once made it skip every instrumented
  // component), so check the served module.
  test("runs and renders the expected React, compiled when COMPILER is set", async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForFunction(() => !!window.__heapTracker && !!window.__leakTest);
    const reactVersion = await page.evaluate(() => window.__leakTest!.reactVersion!);
    expect(reactVersion.split(".")[0], COMBO).toBe(process.env.REACT || "18");

    await expect(page.getByTestId("toggle-leaky"), `the app must render (${COMBO})`).toBeVisible({
      timeout: 10_000,
    });
    expect(pageErrors, `no page errors (${COMBO})`).toEqual([]);

    const module = await (await request.get("/src/components/LeakyTimer.tsx")).text();
    expect(module, `LeakyTimer must be instrumented (${COMBO})`).toContain("LeakyTimer$Heap");
    expect(
      module.includes("react.memo_cache_sentinel"),
      `LeakyTimer compiled by the React Compiler (${COMBO})`,
    ).toBe(!!process.env.COMPILER);
  });

  test("flags the leaky component and clears the fixed one", async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });

    await page.goto("/");

    // Build plugin injected markers and runtime installed.
    await page.waitForFunction(
      () => !!window.__heapTracker && !!window.__leakTest,
    );

    // ── 1) Leaky: mount then unmount ──
    await page.getByTestId("toggle-leaky").click(); // mount
    await expect(page.getByTestId("leaky")).toBeVisible();
    await page.getByTestId("toggle-leaky").click(); // unmount
    await expect(page.getByTestId("leaky")).toHaveCount(0);

    const leaky = await page.evaluate(async () => {
      // Poll: forceGc, check for a LeakyTimer event.
      for (let i = 0; i < 15; i++) {
        const { events } = await window.__leakTest!.collect(3);
        if (events.some((e) => e.component === "LeakyTimer")) return true;
      }
      return false;
    });
    expect(leaky, `LeakyTimer should be flagged as leaked (${COMBO})`).toBe(
      true,
    );

    // ── 2) Fixed: mount then unmount; must be collected without warning. ──
    await page.getByTestId("toggle-fixed").click(); // mount
    await expect(page.getByTestId("fixed")).toBeVisible();
    await page.getByTestId("toggle-fixed").click(); // unmount
    await expect(page.getByTestId("fixed")).toHaveCount(0);

    const fixed = await page.evaluate(async () => {
      const { events, report } = await window.__leakTest!.collect(15);
      return {
        flagged: events.some((e) => e.component === "FixedTimer"),
        inReport: report.some((r) => r.component === "FixedTimer"),
      };
    });
    expect(fixed.flagged, `FixedTimer must not be flagged (${COMBO})`).toBe(
      false,
    );
    expect(
      fixed.inReport,
      `FixedTimer must be GC'd — absent from report (${COMBO})`,
    ).toBe(false);

    // The console-warning path (not just the event API) also fired for the leak.
    expect(
      warnings.some(
        (w) => w.includes("Suspected leak") && w.includes("LeakyTimer"),
      ),
      `expected a console leak warning for LeakyTimer (${COMBO})`,
    ).toBe(true);
  });

  test("flags LeakyAnimationFrame and clears FixedAnimationFrame", async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });

    await page.goto("/");
    await page.waitForFunction(
      () => !!window.__heapTracker && !!window.__leakTest,
    );

    // 1) Leaky RAF: mount then unmount
    await page.getByTestId("toggle-leaky-raf").click(); // mount
    await expect(page.getByTestId("leaky-raf")).toBeVisible();
    await page.getByTestId("toggle-leaky-raf").click(); // unmount
    await expect(page.getByTestId("leaky-raf")).toHaveCount(0);

    const leaky = await page.evaluate(async () => {
      for (let i = 0; i < 15; i++) {
        const { events } = await window.__leakTest!.collect(3);
        if (events.some((e) => e.component === "LeakyAnimationFrame"))
          return true;
      }
      return false;
    });
    expect(
      leaky,
      `LeakyAnimationFrame should be flagged as leaked (${COMBO})`,
    ).toBe(true);

    // 2) Fixed RAF: mount then unmount
    await page.getByTestId("toggle-fixed-raf").click(); // mount
    await expect(page.getByTestId("fixed-raf")).toBeVisible();
    await page.getByTestId("toggle-fixed-raf").click(); // unmount
    await expect(page.getByTestId("fixed-raf")).toHaveCount(0);

    const fixed = await page.evaluate(async () => {
      const { events, report } = await window.__leakTest!.collect(15);
      return {
        flagged: events.some((e) => e.component === "FixedAnimationFrame"),
        inReport: report.some((r) => r.component === "FixedAnimationFrame"),
      };
    });
    expect(
      fixed.flagged,
      `FixedAnimationFrame must not be flagged (${COMBO})`,
    ).toBe(false);
    expect(fixed.inReport, `FixedAnimationFrame must be GC'd (${COMBO})`).toBe(
      false,
    );

    expect(
      warnings.some(
        (w) =>
          w.includes("Suspected leak") && w.includes("LeakyAnimationFrame"),
      ),
      `expected a console leak warning for LeakyAnimationFrame (${COMBO})`,
    ).toBe(true);
  });

  test("flags LeakyListeners and clears FixedListeners", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });

    await page.goto("/");
    await page.waitForFunction(
      () => !!window.__heapTracker && !!window.__leakTest,
    );

    // 1) Leaky Listeners: mount then unmount
    await page.getByTestId("toggle-leaky-listeners").click(); // mount
    await expect(page.getByTestId("leaky-listeners")).toBeVisible();
    await page.getByTestId("toggle-leaky-listeners").click(); // unmount
    await expect(page.getByTestId("leaky-listeners")).toHaveCount(0);

    const leaky = await page.evaluate(async () => {
      for (let i = 0; i < 15; i++) {
        const { events } = await window.__leakTest!.collect(3);
        if (events.some((e) => e.component === "LeakyListeners")) return true;
      }
      return false;
    });
    expect(leaky, `LeakyListeners should be flagged as leaked (${COMBO})`).toBe(
      true,
    );

    // 2) Fixed Listeners: mount then unmount
    await page.getByTestId("toggle-fixed-listeners").click(); // mount
    await expect(page.getByTestId("fixed-listeners")).toBeVisible();
    await page.getByTestId("toggle-fixed-listeners").click(); // unmount
    await expect(page.getByTestId("fixed-listeners")).toHaveCount(0);

    const fixed = await page.evaluate(async () => {
      const { events, report } = await window.__leakTest!.collect(15);
      return {
        flagged: events.some((e) => e.component === "FixedListeners"),
        inReport: report.some((r) => r.component === "FixedListeners"),
      };
    });
    expect(fixed.flagged, `FixedListeners must not be flagged (${COMBO})`).toBe(
      false,
    );
    expect(fixed.inReport, `FixedListeners must be GC'd (${COMBO})`).toBe(
      false,
    );

    expect(
      warnings.some(
        (w) => w.includes("Suspected leak") && w.includes("LeakyListeners"),
      ),
      `expected a console leak warning for LeakyListeners (${COMBO})`,
    ).toBe(true);
  });

  test("flags LeakyPromise and clears FixedPromise", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });

    await page.goto("/");
    await page.waitForFunction(
      () => !!window.__heapTracker && !!window.__leakTest,
    );

    // 1) Leaky Promise: mount then unmount
    await page.getByTestId("toggle-leaky-promise").click(); // mount
    await expect(page.getByTestId("leaky-promise")).toBeVisible();
    await page.getByTestId("toggle-leaky-promise").click(); // unmount
    await expect(page.getByTestId("leaky-promise")).toHaveCount(0);

    const leaky = await page.evaluate(async () => {
      for (let i = 0; i < 15; i++) {
        const { events } = await window.__leakTest!.collect(3);
        if (events.some((e) => e.component === "LeakyPromise")) return true;
      }
      return false;
    });
    expect(leaky, `LeakyPromise should be flagged as leaked (${COMBO})`).toBe(
      true,
    );

    // 2) Fixed Promise: mount then unmount
    await page.getByTestId("toggle-fixed-promise").click(); // mount
    await expect(page.getByTestId("fixed-promise")).toBeVisible();
    await page.getByTestId("toggle-fixed-promise").click(); // unmount
    await expect(page.getByTestId("fixed-promise")).toHaveCount(0);

    const fixed = await page.evaluate(async () => {
      const { events, report } = await window.__leakTest!.collect(15);
      return {
        flagged: events.some((e) => e.component === "FixedPromise"),
        inReport: report.some((r) => r.component === "FixedPromise"),
      };
    });
    expect(fixed.flagged, `FixedPromise must not be flagged (${COMBO})`).toBe(
      false,
    );
    expect(fixed.inReport, `FixedPromise must be GC'd (${COMBO})`).toBe(false);

    expect(
      warnings.some(
        (w) => w.includes("Suspected leak") && w.includes("LeakyPromise"),
      ),
      `expected a console leak warning for LeakyPromise (${COMBO})`,
    ).toBe(true);
  });

  test("default-parameter callbacks don't throw (no false crash)", async ({
    page,
  }) => {
    // Audit issue #2: the detector used to inject its closure capture into
    // closures in a component's/hook's OWN default parameters, which can't see
    // the body var — so invoking the default threw ReferenceError. Mount a
    // component whose hook default runs on render and whose prop default runs
    // on click, and assert the page stays error-free while still being tracked.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForFunction(
      () => !!window.__heapTracker && !!window.__leakTest,
    );

    await page.getByTestId("toggle-default-callback").click(); // mount
    const button = page.getByTestId("default-callback");
    await expect(button).toHaveText(/clicked 0/);
    await button.click(); // invokes the default onSelect
    await expect(button).toHaveText(/clicked 1/);

    // Skipping the param closures must not cost us the marker.
    const tracked = await page.evaluate(() =>
      window.__heapTracker!.report().some((r) => r.component === "DefaultCallback"),
    );
    expect(tracked, `DefaultCallback should be tracked (${COMBO})`).toBe(true);
    expect(
      pageErrors,
      `no uncaught errors expected from default-parameter closures (${COMBO})`,
    ).toEqual([]);
  });
  // The README installs the runtime with a fire-and-forget dynamic import(),
  // which resolves after React's first render and commit. /late.html does
  // exactly that (see fixture/src/late.tsx) and mounts LeakyTimer in the
  // initial tree, so its track() call happens while the tracker is absent.
  // The runtime must adopt the marker on unmount and still flag the leak.
  test("flags a leaky component mounted before the runtime loaded (README dynamic import)", async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });

    await page.goto("/late.html");
    await page.waitForFunction(
      () => !!window.__heapTracker && !!window.__leakTest,
    );

    // Scenario guard: the initial render really did happen before install.
    const trackerAtRender = await page.evaluate(
      () => window.__leakTest!.trackerAtRender,
    );
    expect(
      trackerAtRender,
      `the fixture must render before the runtime installs (${COMBO})`,
    ).toBe(false);
    await expect(page.getByTestId("leaky")).toBeVisible();

    // Unmount the component that was mounted before the runtime existed.
    await page.getByTestId("toggle-leaky").click();
    await expect(page.getByTestId("leaky")).toHaveCount(0);

    const leaky = await page.evaluate(async () => {
      for (let i = 0; i < 15; i++) {
        const { events } = await window.__leakTest!.collect(3);
        if (events.some((e) => e.component === "LeakyTimer")) return true;
      }
      return false;
    });
    expect(
      leaky,
      `LeakyTimer mounted before the runtime loaded should still be flagged (${COMBO})`,
    ).toBe(true);

    // The adopted marker is reported under its real component name.
    const row = await page.evaluate(() =>
      window.__heapTracker!.report().find((r) => r.component === "LeakyTimer"),
    );
    expect(row?.stale, `LeakyTimer should be stale in report() (${COMBO})`).toBeGreaterThanOrEqual(1);

    expect(
      warnings.some(
        (w) => w.includes("Suspected leak") && w.includes("LeakyTimer"),
      ),
      `expected a console leak warning for LeakyTimer (${COMBO})`,
    ).toBe(true);
  });

  // A cleaned-up component survives minor collections (scavenges) until the
  // next major one: dead DOM-side records still point at its callbacks. The
  // runtime must treat only a major collection as evidence (src/witness.ts).
  // Checked here on a component rendered before the runtime loaded, adopted
  // at unmount, with its marker promoted to the old generation first, the
  // way an app shell's components would be. Forced minor GCs
  // (gc({ type: "minor" }), needs --expose-gc) make it deterministic.
  test("an adopted component that cleaned up is not reported after minor GCs alone", async ({
    page,
  }) => {
    await page.goto("/late.html");
    await page.waitForFunction(
      () => !!window.__heapTracker && !!window.__leakTest,
    );
    expect(await page.evaluate(() => window.__leakTest!.trackerAtRender)).toBe(false);
    await expect(page.getByTestId("fixed")).toBeVisible();

    type MinorGc = (options: { type: "minor" }) => void;
    /** Forced minor GCs, a macrotask apart (a WeakRef isn't cleared in the turn it was read). */
    const minorGcs = (cycles: number) =>
      page.evaluate(async (cycles) => {
        const gc = (window as unknown as { gc: MinorGc }).gc;
        for (let i = 0; i < cycles; i++) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          gc({ type: "minor" });
          await new Promise((resolve) => setTimeout(resolve, 15));
          window.__heapTracker!.sweep();
        }
        return {
          events: window.__leakTest!.events.slice() as LeakEvent[],
          report: window.__heapTracker!.report(),
        };
      }, cycles);

    // Promote FixedTimer's marker (rendered before the runtime loaded) to the
    // old generation, then unmount it: the runtime adopts it.
    await minorGcs(4);
    await page.getByTestId("toggle-fixed").click();
    await expect(page.getByTestId("fixed")).toHaveCount(0);

    const afterMinor = await minorGcs(8);
    // Scenario guard: minor GCs don't free the marker, so FixedTimer is still
    // in memory here, stale (leakAgeMs 0). Counting a minor GC as evidence
    // would get it reported.
    expect(
      afterMinor.report.find((r) => r.component === "FixedTimer"),
      `FixedTimer must still be in memory after minor GCs (${COMBO})`,
    ).toBeDefined();
    expect(
      afterMinor.events.some((e) => e.component === "FixedTimer"),
      `FixedTimer must not be reported after minor GCs alone (${COMBO})`,
    ).toBe(false);

    // Full collections free it, still without a report.
    const { events, report } = await page.evaluate(() => window.__leakTest!.collect(15));
    expect(
      report.some((r) => r.component === "FixedTimer"),
      `FixedTimer must be GC'd — absent from report (${COMBO})`,
    ).toBe(false);
    expect(
      events.some((e) => e.component === "FixedTimer"),
      `FixedTimer must never be reported (${COMBO})`,
    ).toBe(false);
  });

  // DevTools' "Collect garbage" must give a verdict in one click, however many
  // separate unmounts came before it. The runtime needs an old-generation
  // witness released after an instance goes stale (src/witness.ts). Taking a
  // fresh one per unmount would empty its small stock after a few unmounts
  // without a collection in between, and every later instance would wait
  // through several more collections (clicks).
  test("one Collect garbage click reports every leaked instance after a burst of unmounts", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForFunction(
      () => !!window.__heapTracker && !!window.__leakTest,
    );
    const BURST = 10;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.enable");
    // A page that has been running a while: the witness stock is seasoned.
    for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(100);

    // Mount and unmount LeakyTimer BURST times, each unmount in a task of its
    // own, with nothing forcing a collection (no window.gc).
    await page.evaluate(async (burst) => {
      const toggle = () =>
        (document.querySelector('[data-testid="toggle-leaky"]') as HTMLElement).click();
      for (let i = 0; i < burst; i++) {
        toggle(); // mount
        await new Promise((resolve) => setTimeout(resolve, 0));
        toggle(); // unmount
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }, BURST);

    await cdp.send("HeapProfiler.collectGarbage"); // the one click
    await page.waitForTimeout(100);
    const row = await page.evaluate(() => {
      window.__heapTracker!.report(); // sweeps
      return window.__heapTracker!.report().find((r) => r.component === "LeakyTimer");
    });
    expect(
      row,
      `all ${BURST} LeakyTimer instances reported after one click (${COMBO}): ${JSON.stringify(row)}`,
    ).toMatchObject({ live: BURST, stale: BURST });
  });
});
