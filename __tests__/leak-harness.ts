// Test harness for the real-GC leak suite. Two responsibilities:
//
//  1. Seed the process-global collections that the *leaky* fixtures register
//     into (a subscriber list, an event bus, an in-flight-request registry).
//     Teardown drops/settles them so a leak can't bleed across tests.
//
//  2. Wrap the timer / animation-frame globals so any handle a leaky fixture
//     never cleared can be closed in teardown, leaving no live timers behind.
//
// The wrappers are PLAIN functions, never jest.spyOn: a jest mock records every
// call's arguments in `mock.calls`, which would strongly retain each callback
// (and, through it, the component's $Heap marker) and make even a correctly-
// cleaned component look leaked. The wrappers keep only the numeric handles.

export type InflightEntry = {
  resolve?: () => void;
  reject?: (reason?: unknown) => void;
};

type HarnessGlobals = typeof globalThis & {
  __HEAP_LEAK_SINK__?: Array<() => void>;
  __HEAP_EVENT_TARGET__?: EventTarget;
  __HEAP_INFLIGHT__?: Set<InflightEntry>;
};

const g = globalThis as HarnessGlobals;

type SavedTimers = {
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  requestAnimationFrame: typeof requestAnimationFrame;
  cancelAnimationFrame: typeof cancelAnimationFrame;
};

let saved: SavedTimers | null = null;

const open = {
  intervals: new Set<ReturnType<typeof setInterval>>(),
  timeouts: new Set<ReturnType<typeof setTimeout>>(),
  frames: new Set<number>(),
};

// Wrap one schedule/cancel timer pair so every handle a fixture opens is
// recorded in `openHandles` (teardown force-closes whatever a leaky fixture
// never cleared). The set holds ONLY the numeric handle, never the callback —
// see the file header for why that matters (jest.spyOn would retain it).
function trackPair<H>(
  schedule: (...args: any[]) => H,
  cancel: (id: any) => unknown,
  openHandles: Set<H>,
): { schedule: (...args: any[]) => H; cancel: (id: any) => unknown } {
  return {
    schedule: (...args) => {
      const id = schedule(...args);
      openHandles.add(id);
      return id;
    },
    cancel: (id) => {
      if (id !== undefined) openHandles.delete(id as H);
      return cancel(id);
    },
  };
}

export function installHarness(): void {
  g.__HEAP_LEAK_SINK__ = [];
  g.__HEAP_EVENT_TARGET__ = new EventTarget();
  g.__HEAP_INFLIGHT__ = new Set();

  open.intervals.clear();
  open.timeouts.clear();
  open.frames.clear();

  const s: SavedTimers = {
    setInterval: g.setInterval,
    clearInterval: g.clearInterval,
    setTimeout: g.setTimeout,
    clearTimeout: g.clearTimeout,
    requestAnimationFrame: g.requestAnimationFrame,
    cancelAnimationFrame: g.cancelAnimationFrame,
  };
  saved = s;

  const interval = trackPair(s.setInterval, s.clearInterval, open.intervals);
  g.setInterval = interval.schedule as typeof setInterval;
  g.clearInterval = interval.cancel as typeof clearInterval;

  const timeout = trackPair(s.setTimeout, s.clearTimeout, open.timeouts);
  g.setTimeout = timeout.schedule as typeof setTimeout;
  g.clearTimeout = timeout.cancel as typeof clearTimeout;

  const frame = trackPair(
    s.requestAnimationFrame,
    s.cancelAnimationFrame,
    open.frames,
  );
  g.requestAnimationFrame = frame.schedule as typeof requestAnimationFrame;
  g.cancelAnimationFrame = frame.cancel as typeof cancelAnimationFrame;
}

export function teardownHarness(): void {
  const s = saved;
  if (s) {
    open.intervals.forEach((id) => s.clearInterval(id));
    open.timeouts.forEach((id) => s.clearTimeout(id));
    open.frames.forEach((id) => s.cancelAnimationFrame(id));
    g.setInterval = s.setInterval;
    g.clearInterval = s.clearInterval;
    g.setTimeout = s.setTimeout;
    g.clearTimeout = s.clearTimeout;
    g.requestAnimationFrame = s.requestAnimationFrame;
    g.cancelAnimationFrame = s.cancelAnimationFrame;
    saved = null;
  }
  open.intervals.clear();
  open.timeouts.clear();
  open.frames.clear();

  // Settle any request a leaky fixture left in flight (resolve, not reject, so
  // the no-catch leaky chain raises no unhandled rejection), then drop the
  // test-owned collections so their retained closures become collectable.
  g.__HEAP_INFLIGHT__?.forEach((entry) => entry.resolve?.());
  g.__HEAP_INFLIGHT__ = new Set();
  g.__HEAP_LEAK_SINK__ = [];
  g.__HEAP_EVENT_TARGET__ = new EventTarget();
}
