import { expect, test } from "@playwright/test";

// The detector as users run it: default runtime options (defaults.html sets
// no window.__heapTrackerOptions) in a Chromium launched WITHOUT --expose-gc
// (the "chromium-no-gc" project in playwright.config.ts), so nothing forces a
// garbage collection.
//
// A component that cleaned up correctly is unreachable after unmount, but it
// stays in memory until the browser happens to collect garbage, and an idle
// tab may not collect for a long time. The detector must not report it in
// the meantime. A real leak must still be reported once a collection has run,
// triggered here the way a user would: DevTools' "Collect garbage" button
// (HeapProfiler.collectGarbage over the DevTools protocol).
//
// The scenario only exists while the correctly cleaned-up components are
// still in memory at the check. If the browser already freed them on its own
// (and they weren't reported), the run can't show anything about GC lag, and
// the test skips itself as inconclusive instead of passing by luck.
//
// Why not a canary object: Chrome runs minor collections constantly, and they
// free young objects such as a fresh canary, but not the markers, which by
// unmount have been promoted to the old generation and need a full
// collection. A collected canary says nothing about the markers.

const COMBO = `plugin-react ${process.env.PLUGIN_REACT || "v6"} / engine ${
  process.env.HEAP_ENGINE || "auto"
} / React ${process.env.REACT || "18"}${process.env.COMPILER ? " + compiler" : ""}`;

// Runtime defaults (src/config.ts). A stale instance can first be reported
// by the sweep that follows LEAK_AGE_MS; one more sweep interval of margin.
const LEAK_AGE_MS = 10_000;
const SWEEP_INTERVAL_MS = 2_000;
const FIRST_VERDICT_MS = LEAK_AGE_MS + 2 * SWEEP_INTERVAL_MS;

const FIXED = [
  ["toggle-fixed", "fixed", "FixedTimer"],
  ["toggle-fixed-raf", "fixed-raf", "FixedAnimationFrame"],
  ["toggle-fixed-listeners", "fixed-listeners", "FixedListeners"],
  ["toggle-fixed-promise", "fixed-promise", "FixedPromise"],
] as const;
const LEAKY = ["toggle-leaky", "leaky", "LeakyTimer"] as const;

type ReportRow = { component: string; live: number; stale: number };
// Page globals this spec touches (leak.spec.ts declares its own view of
// window.__heapTracker, so this one stays local instead of augmenting Window).
type PageGlobals = {
  __heapTracker?: { report(): ReportRow[] };
  gc?: unknown;
};

test.describe(`garbage-collection lag, default options, no --expose-gc — ${COMBO}`, () => {
  test("correctly cleaned-up components are not reported; the leak is, once a collection has run", async ({
    page,
  }) => {
    test.setTimeout(FIRST_VERDICT_MS + 60_000);

    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning" && msg.text().includes("Suspected leak")) {
        warnings.push(msg.text());
      }
    });
    const reported = (name: string) => warnings.some((w) => w.includes(`leak: ${name} `));

    await page.goto("/defaults.html");
    await page.waitForFunction(() => !!(window as unknown as PageGlobals).__heapTracker);
    expect(
      await page.evaluate(() => typeof (window as unknown as PageGlobals).gc),
      "window.gc must not exist in this project",
    ).toBe("undefined");

    // Mount everything, then unmount everything.
    for (const [toggle, testId] of [...FIXED, LEAKY]) {
      await page.getByTestId(toggle).click();
      await expect(page.getByTestId(testId)).toBeVisible();
    }
    for (const [toggle, testId] of [...FIXED, LEAKY]) {
      await page.getByTestId(toggle).click();
      await expect(page.getByTestId(testId)).toHaveCount(0);
    }

    // ── 1) After leakAgeMs, with no forced collection ──
    await page.waitForTimeout(FIRST_VERDICT_MS);
    const inMemory = await page.evaluate(() =>
      (window as unknown as PageGlobals).__heapTracker!.report().map((r) => r.component),
    );
    const conclusive = FIXED.some(([, , name]) => reported(name) || inMemory.includes(name));
    test.skip(
      !conclusive,
      "Inconclusive: the browser freed the cleaned-up components on its own " +
        "before the check, so there was no garbage-collection lag to test.",
    );
    for (const [, , name] of FIXED) {
      expect(
        reported(name),
        `${name} cleaned up correctly and must not be reported before any ` +
          `garbage collection has run (${COMBO})`,
      ).toBe(false);
    }

    // ── 2) The user clicks "Collect garbage" in DevTools ──
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(2 * SWEEP_INTERVAL_MS);

    const report = await page.evaluate(() => (window as unknown as PageGlobals).__heapTracker!.report());
    for (const [, , name] of FIXED) {
      expect(
        report.find((r) => r.component === name),
        `${name} must be collected (${COMBO})`,
      ).toBeUndefined();
      expect(reported(name), `${name} must never be reported (${COMBO})`).toBe(false);
    }
    expect(
      report.find((r) => r.component === LEAKY[2])?.stale,
      `${LEAKY[2]} must still be retained (${COMBO})`,
    ).toBeGreaterThanOrEqual(1);
    expect(reported(LEAKY[2]), `${LEAKY[2]} must be reported (${COMBO})`).toBe(true);
  });
});
