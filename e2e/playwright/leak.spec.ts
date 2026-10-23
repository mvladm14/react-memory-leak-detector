import { expect, test } from "@playwright/test";

// Labels the run with the matrix combo under test (set by run.mjs).
const COMBO = `plugin-react ${process.env.PLUGIN_REACT || "v6"} / engine ${
  process.env.HEAP_ENGINE || "auto"
}`;

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
      collect(
        cycles?: number,
      ): Promise<{ events: LeakEvent[]; report: ReportRow[] }>;
    };
  }
}

test.describe(`live leak detection — ${COMBO}`, () => {
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
});
