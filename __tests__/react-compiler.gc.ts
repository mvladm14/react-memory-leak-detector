// Leak detection on components the React Compiler actually compiled.
//
// react-compiler.test.js proves the compiler accepts instrumented code; this
// proves the result still does the job: the compiler memoizes closures in its
// per-instance cache, and a leak must still be flagged and a correct component
// still collected. Fixtures are compiled at test time (see compile-fixture.ts)
// through each supported pipeline, targeting the installed React (the
// react-compiler-runtime package on 17/18, react/compiler-runtime on 19).

import React from "react";
import { render, cleanup } from "@testing-library/react";

import "../src/runtime";

import { installHarness, teardownHarness } from "./leak-harness";
import { compileFixture, type CompiledFixture } from "./compile-fixture";
import { oxcAvailable } from "./oxc-available";
import type { LeakEvent } from "../src/types";

const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
const tracker = () => window.__heapTracker!;

async function forceCollect(cycles = 5): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    gc!();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const row = (name: string) => tracker().report().find((r) => r.component === name);

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
});

afterEach(() => {
  cleanup();
  teardownHarness();
});

const PIPELINES: Array<[string, "oxc" | "babel" | undefined]> = [
  // Vite plugin / Next.js wrapper: our transform first, compiler afterwards.
  ...(oxcAvailable ? ([["oxc pre-pass", "oxc"]] as Array<[string, "oxc"]>) : []),
  ["babel pre-pass", "babel"],
  // webpack / .babelrc: heap plugin and compiler in the same Babel pass.
  ["same Babel pass", undefined],
];

// Both fixtures forget their cleanup. The interval callback uses component
// state, so the compiler keeps it inside the component in every pipeline. The
// listener fixture's effect and handler use nothing from the component: a
// compiler that sees them first (same Babel pass — it compiles on Program
// enter, before our visitors) hoists both to module scope, so the listener no
// longer retains the component and, being the same function on every mount,
// isn't even added twice. There is nothing to attribute, and no event is
// expected. When our transform runs first (Vite / Next.js), the `_heap_ && 0`
// capture keeps those closures per-instance, so the missing cleanup is
// reported. The README's compatibility table describes this difference.
const CASES: Array<[string, string, string]> = [
  ["setInterval", "TimerLeakComponent", "TimerFixedComponent"],
  ["event listener", "ListenerLeakComponent", "ListenerFixedComponent"],
];

describe.each(PIPELINES)(`React Compiler (%s, React ${React.version})`, (_label, engine) => {
  const samePass = engine === undefined;
  // Compile up front: the first compile loads Babel, the compiler and Oxc
  // cold, which alone can outlast Jest's 5 s test timeout on a busy runner.
  const compiled = new Map<string, CompiledFixture>();
  beforeAll(async () => {
    for (const [, leakName, fixedName] of CASES) {
      for (const name of [leakName, fixedName]) {
        compiled.set(name, await compileFixture(`${name}.tsx`, { engine, reactCompiler: true }));
      }
    }
  }, 60_000);

  test.each(CASES)("%s: missing cleanup reported as described above, fix collected", async (culprit, leakName, fixedName) => {
    const expectFlagged = !(samePass && culprit === "event listener");
    const leak = compiled.get(leakName)!;
    const fixed = compiled.get(fixedName)!;
    for (const c of [leak, fixed]) {
      expect(c.compilerProblems).toEqual([]);
      // Really compiled (memo cache), and really instrumented.
      expect(c.code).toMatch(/compiler-runtime/);
      expect(c.code).toMatch(/\$Heap\(\)/);
    }

    const events: LeakEvent[] = [];
    const unsubscribe = tracker().subscribe((e) => events.push(e));

    const { unmount } = render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(leak.exports[leakName]),
        React.createElement(fixed.exports[fixedName]),
      ),
    );
    unmount();
    cleanup();

    await forceCollect();
    for (let i = 0; i < 12 && row(fixedName); i++) await forceCollect();
    tracker().sweep();
    unsubscribe();

    expect(row(fixedName)).toBeUndefined();
    expect(events.map((e) => e.component)).toEqual(expectFlagged ? [leakName] : []);
  });
});
