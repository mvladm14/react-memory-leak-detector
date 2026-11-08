import { expect, test, type Page } from "@playwright/test";

// Set by run.mjs per combo.
const COMBO = process.env.NEXT_COMBO || "next (unknown combo)";
// Whether a component with no "use client" directive is instrumented when a
// Client Component renders it (false only for Next 15's Turbopack fallback).
const SHARED_INSTRUMENTED = process.env.NEXT_SHARED_INSTRUMENTED !== "0";

type LeakEvent = { component: string; stale: number; live: number };
type ReportRow = { component: string; live: number; stale: number };
declare global {
  interface Window {
    __heapTracker?: {
      report(): ReportRow[];
      forceGc(): void;
      subscribe(fn: (e: LeakEvent) => void): () => void;
    };
    __heapTrackerOptions?: Record<string, unknown>;
    __e2e?: { events: LeakEvent[] };
  }
}

/**
 * Records uncaught page errors and console errors (hydration mismatches, React
 * errors). Resource 404s are ignored: the fixture has no favicon.
 */
function recordErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource")) {
      errors.push(`console.error: ${msg.text()}`);
    }
  });
  return errors;
}

function recordWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "warning") warnings.push(msg.text());
  });
  return warnings;
}

/** Loads a route, waits for the runtime, and starts capturing leak events. */
async function open(page: Page, route: string) {
  const res = await page.goto(route);
  // A compile error (e.g. hooks injected into a Server Component, or next/font
  // without SWC) makes Next answer 500.
  expect(res?.status(), `${route} should render (${COMBO})`).toBe(200);
  await page.waitForFunction(() => !!window.__heapTracker);
  await page.evaluate(() => {
    window.__e2e = { events: [] };
    window.__heapTracker!.subscribe((e) => window.__e2e!.events.push(e));
  });
}

/**
 * Forces GC in cycles (a WeakRef target can't be reclaimed within the same
 * macrotask it was last observed, so yield between collections) and returns
 * the events seen so far plus the tracker's report.
 */
async function collect(page: Page, cycles: number) {
  return page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) {
      window.__heapTracker!.forceGc();
      await new Promise((r) => setTimeout(r, 15));
    }
    return {
      events: window.__e2e!.events.slice(),
      report: window.__heapTracker!.report(),
    };
  }, cycles);
}

async function mountThenUnmount(page: Page, toggle: string, testId: string) {
  await page.getByTestId(toggle).click();
  await expect(page.getByTestId(testId)).toBeVisible();
  await page.getByTestId(toggle).click();
  await expect(page.getByTestId(testId)).toHaveCount(0);
}

async function expectLeakFlagged(page: Page, warnings: string[]) {
  await mountThenUnmount(page, "toggle-leaky", "leaky");
  let flagged = false;
  for (let i = 0; i < 15 && !flagged; i++) {
    const { events } = await collect(page, 3);
    flagged = events.some((e) => e.component === "LeakyTimer");
  }
  expect(flagged, `LeakyTimer should be flagged as leaked (${COMBO})`).toBe(true);
  expect(
    warnings.some((w) => w.includes("Suspected leak") && w.includes("LeakyTimer")),
    `expected a console leak warning for LeakyTimer (${COMBO})`,
  ).toBe(true);
}

async function expectNoFalsePositive(page: Page) {
  await mountThenUnmount(page, "toggle-fixed", "fixed");
  const { events, report } = await collect(page, 15);
  expect(
    events.some((e) => e.component === "FixedTimer"),
    `FixedTimer must not be flagged (${COMBO})`,
  ).toBe(false);
  expect(
    report.some((r) => r.component === "FixedTimer"),
    `FixedTimer must be GC'd, so absent from report() (${COMBO})`,
  ).toBe(false);
}

test.describe(`Next.js integration: ${COMBO}`, () => {
  test("App Router: flags the leaky component and clears the fixed one", async ({ page }) => {
    const errors = recordErrors(page);
    const warnings = recordWarnings(page);
    await open(page, "/");

    // The Server Component that imports from "react" rendered (it used to get
    // useRef/useEffect injected, which Next refuses to compile).
    await expect(page.getByTestId("server-rendered")).toBeVisible();

    // withHeapMarkers() options reached the runtime.
    const options = await page.evaluate(() => window.__heapTrackerOptions);
    expect(options, `plugin options should be forwarded (${COMBO})`).toMatchObject({
      leakAgeMs: 0,
      warnCooldownMs: 0,
    });

    await expectLeakFlagged(page, warnings);
    await expectNoFalsePositive(page);
    expect(errors, `no page errors (${COMBO})`).toEqual([]);
  });

  test("App Router: a component without a directive is instrumented only in the browser bundle", async ({
    page,
  }) => {
    const errors = recordErrors(page);
    await open(page, "/");
    // Label renders as a Server Component and as a Client Component on the
    // same page; both copies must work.
    await expect(page.getByTestId("label-from-server")).toBeVisible();
    await expect(page.getByTestId("label-from-client")).toBeVisible();

    // Mount a fresh client-side Label now that the runtime is loaded, so the
    // check doesn't depend on when the runtime arrived (late on Next 14).
    await page.getByTestId("toggle-label").click();
    await expect(page.getByTestId("label-mounted-later")).toBeVisible();
    const tracked = await page.evaluate(() =>
      window.__heapTracker!.report().map((r) => r.component),
    );
    expect(
      tracked.includes("Label"),
      `shared Label should ${SHARED_INSTRUMENTED ? "" : "NOT "}be instrumented in the browser (${COMBO})`,
    ).toBe(SHARED_INSTRUMENTED);
    expect(errors, `no page errors (${COMBO})`).toEqual([]);
  });

  test("Pages Router: runtime from _app flags the leak", async ({ page }) => {
    const errors = recordErrors(page);
    const warnings = recordWarnings(page);
    await open(page, "/legacy");
    await expectLeakFlagged(page, warnings);
    await expectNoFalsePositive(page);
    expect(errors, `no page errors (${COMBO})`).toEqual([]);
  });
});
