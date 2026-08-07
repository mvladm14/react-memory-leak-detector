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

    // The build plugin injected markers and the runtime installed.
    await page.waitForFunction(
      () => !!window.__heapTracker && !!window.__leakTest,
    );

    // ── 1) Leaky: mount then unmount, then force GC and poll for a verdict. ──
    await page.getByTestId("toggle-leaky").click(); // mount
    await expect(page.getByTestId("leaky")).toBeVisible();
    await page.getByTestId("toggle-leaky").click(); // unmount
    await expect(page.getByTestId("leaky")).toHaveCount(0);

    const leaky = await page.evaluate(async () => {
      // Poll: forceGc a few cycles, check for a LeakyTimer event, repeat.
      for (let i = 0; i < 15; i++) {
        const { events } = await window.__leakTest!.collect(3);
        if (events.some((e) => e.component === "LeakyTimer")) return true;
      }
      return false;
    });
    expect(leaky, `LeakyTimer should be flagged as leaked (${COMBO})`).toBe(
      true,
    );

    // ── 2) Fixed: mount then unmount; it must be collected, never flagged. ──
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
});
