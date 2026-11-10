import { loadRuntime, simulateGc, type RuntimeModules } from "./helpers";
import type { LeakEvent } from "../src/types";

/**
 * Helper: tracks an instance and makes it stale by setting its unmountedAt
 * deep in the past, regardless of how long the test has been running. Not a
 * leak yet: no garbage collection has run since.
 */
function makeStaleInstance(mods: RuntimeModules, name: string): object {
  const instance = {};
  mods.lifecycle.track(instance, name);
  mods.lifecycle.markMounted(instance);
  mods.lifecycle.markUnmounted(instance);
  mods.store.instanceToEntry.get(instance)!.unmountedAt = Date.now() - 1_000_000;
  return instance;
}

/**
 * Helper: a stale instance that a garbage collection has since left in
 * memory, i.e. a leak the next sweep reports.
 */
function makeLeakedInstance(mods: RuntimeModules, name: string): object {
  const instance = makeStaleInstance(mods, name);
  mods.witness.syncWitness(mods.store.instanceToEntry.get(instance)!, Date.now());
  simulateGc(mods);
  return instance;
}

describe("sweep", () => {
  let mods: RuntimeModules;

  beforeEach(() => {
    mods = loadRuntime();
    // Silence console noise from sweep warnings; individual tests opt back in
    // with a spy when they need to assert on it.
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "table").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does nothing when there are no tracked entries", () => {
    const listener = jest.fn();
    mods.subscribers.subscribe(listener);
    mods.sweep.sweep();
    expect(listener).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("does not warn or emit for currently-mounted entries", () => {
    const listener = jest.fn();
    mods.subscribers.subscribe(listener);
    const instance = {};
    mods.lifecycle.track(instance, "Card");
    mods.lifecycle.markMounted(instance);
    mods.sweep.sweep();
    expect(listener).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("does not warn or emit when an unmount is too recent", () => {
    const listener = jest.fn();
    mods.subscribers.subscribe(listener);
    const instance = {};
    mods.lifecycle.track(instance, "Card");
    mods.lifecycle.markMounted(instance);
    mods.lifecycle.markUnmounted(instance); // unmountedAt = now, not stale yet
    mods.sweep.sweep();
    expect(listener).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns and emits a LeakEvent for entries still in memory after a collection", () => {
    const events: LeakEvent[] = [];
    mods.subscribers.subscribe((e) => events.push(e));
    makeLeakedInstance(mods, "Card");
    mods.sweep.sweep();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      component: "Card",
      stale: 1,
      live: 1,
      leakAgeMs: mods.config._config.leakAgeMs,
    });
    expect(typeof events[0].at).toBe("number");
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("respects suspectThreshold", () => {
    mods.config.configure({ suspectThreshold: 3 });
    const listener = jest.fn();
    mods.subscribers.subscribe(listener);
    // Only 2 stale instances — below threshold of 3.
    makeLeakedInstance(mods, "Card");
    makeLeakedInstance(mods, "Card");
    mods.sweep.sweep();
    expect(listener).not.toHaveBeenCalled();
    // Add a third to cross the threshold.
    makeLeakedInstance(mods, "Card");
    mods.sweep.sweep();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ component: "Card", stale: 3 }),
    );
  });

  it("respects warnCooldownMs (no duplicate fire within cooldown)", () => {
    const listener = jest.fn();
    mods.subscribers.subscribe(listener);
    makeLeakedInstance(mods, "Card");
    mods.sweep.sweep();
    mods.sweep.sweep();
    mods.sweep.sweep();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("fires again after the cooldown elapses", () => {
    mods.config.configure({ warnCooldownMs: 50 });
    const listener = jest.fn();
    mods.subscribers.subscribe(listener);
    makeLeakedInstance(mods, "Card");

    const realNow = Date.now;
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(realNow());
    mods.sweep.sweep();
    expect(listener).toHaveBeenCalledTimes(1);

    // Advance "now" past the cooldown window.
    nowSpy.mockReturnValue(realNow() + 1_000);
    mods.sweep.sweep();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not emit if no listeners are subscribed (but still warns)", () => {
    makeLeakedInstance(mods, "Card");
    mods.sweep.sweep();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("report returns rows sorted by stale desc, then live desc", () => {
    // 1 stale Card; 2 live (mounted) Banner; 1 stale + 1 mounted Modal.
    makeLeakedInstance(mods, "Card");

    const b1 = {};
    const b2 = {};
    mods.lifecycle.track(b1, "Banner");
    mods.lifecycle.markMounted(b1);
    mods.lifecycle.track(b2, "Banner");
    mods.lifecycle.markMounted(b2);

    makeLeakedInstance(mods, "Modal");
    const m2 = {};
    mods.lifecycle.track(m2, "Modal");
    mods.lifecycle.markMounted(m2);

    const rows = mods.sweep.report();
    // Modal: 1 stale, 2 live. Card: 1 stale, 1 live. Banner: 0 stale, 2 live.
    expect(rows.map((r) => r.component)).toEqual(["Modal", "Card", "Banner"]);
    expect(rows[0]).toMatchObject({
      component: "Modal",
      stale: 1,
      awaitingGc: 0,
      live: 2,
    });
  });

  it("forceGc logs an info message when window.gc is unavailable and still sweeps", () => {
    // jsdom has no window.gc → should hit the "not available" branch.
    makeLeakedInstance(mods, "Card");
    const listener = jest.fn();
    mods.subscribers.subscribe(listener);
    mods.sweep.forceGc();
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining("window.gc not available"),
    );
    // sweep ran as part of forceGc → listener fired.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("forceGc invokes window.gc when present", () => {
    const gc = jest.fn();
    (window as typeof window & { gc?: () => void }).gc = gc;
    try {
      mods.sweep.forceGc();
      expect(gc).toHaveBeenCalledTimes(1);
    } finally {
      delete (window as typeof window & { gc?: () => void }).gc;
    }
  });
});

// An instance still in memory leakAgeMs after unmount is reported only once a
// major garbage collection has run since (src/witness.ts). Before that it may
// just not have been collected yet: reporting it was the false positive this
// guards against. The unit suites have no real gc(); `simulateGc` collects
// the released witnesses. Real collections: __tests__/gc-lag.gc.ts and the
// Chromium e2e (e2e/playwright/gc-during-unmount.spec.ts).
describe("garbage-collection evidence", () => {
  let mods: RuntimeModules;
  let events: LeakEvent[];

  const entryOf = (instance: object) => mods.store.instanceToEntry.get(instance)!;
  const rowOf = (name: string) =>
    mods.sweep.report().find((r) => r.component === name);
  /**
   * Sweep and return the components it reports: every component currently
   * leaked, since the warning cooldown is reset first (with warnCooldownMs 0
   * a repeat report would otherwise depend on the clock having ticked).
   */
  const flagged = () => {
    mods.store.stats.forEach((s) => (s.lastWarnedAt = 0));
    events = [];
    mods.sweep.sweep();
    return events.map((e) => e.component).sort();
  };
  const load = (opts?: { seasoned?: boolean }) => {
    mods = loadRuntime(opts);
    mods.config.configure({ logging: false });
    events = [];
    mods.subscribers.subscribe((e) => events.push(e));
  };
  const mountedThenUnmounted = (name: string) => {
    const instance = {};
    mods.lifecycle.track(instance, name);
    mods.lifecycle.markMounted(instance);
    mods.lifecycle.markUnmounted(instance);
    return instance;
  };

  beforeEach(() => load());

  it("does not report a stale instance before any collection: it is awaiting GC", () => {
    makeStaleInstance(mods, "Card");
    expect(flagged()).toEqual([]);
    expect(rowOf("Card")).toMatchObject({ live: 1, stale: 0, awaitingGc: 1 });
  });

  it("reports it once a collection has run and left it in memory", () => {
    makeStaleInstance(mods, "Card");
    expect(flagged()).toEqual([]);
    simulateGc(mods);
    expect(flagged()).toEqual(["Card"]);
    expect(rowOf("Card")).toMatchObject({ live: 1, stale: 1, awaitingGc: 0 });
  });

  it("a collection that ran before the instance went stale does not count", () => {
    const instance = mountedThenUnmounted("Card"); // recent: within leakAgeMs
    mods.sweep.sweep();
    expect(entryOf(instance).witness).toBeNull();
    simulateGc(mods);
    entryOf(instance).unmountedAt = Date.now() - 1_000_000; // time passes
    expect(flagged()).toEqual([]);
    expect(rowOf("Card")).toMatchObject({ stale: 0, awaitingGc: 1 });
    simulateGc(mods);
    expect(flagged()).toEqual(["Card"]);
  });

  it("gives an instance a witness once it is stale, not before", () => {
    const instance = {};
    mods.lifecycle.track(instance, "Card");
    const entry = entryOf(instance);
    mods.lifecycle.markMounted(instance);
    expect(entry.witness).toBeNull();
    mods.lifecycle.markUnmounted(instance);
    mods.sweep.sweep();
    expect(entry.witness).toBeNull(); // unmounted < leakAgeMs ago
    entry.unmountedAt = Date.now() - 1_000_000;
    mods.sweep.sweep();
    expect(entry.witness).not.toBeNull();
  });

  it("with leakAgeMs 0, gives the witness at unmount", () => {
    mods.config.configure({ leakAgeMs: 0 });
    const instance = mountedThenUnmounted("Card");
    expect(entryOf(instance).witness).not.toBeNull();
    simulateGc(mods);
    expect(flagged()).toEqual(["Card"]);
  });

  it("instances going stale share the witness until a collection frees it", async () => {
    mods.config.configure({ leakAgeMs: 0 });
    const a = mountedThenUnmounted("A");
    const b = mountedThenUnmounted("B");
    expect(entryOf(a).witness).not.toBeNull();
    expect(entryOf(b).witness).toBe(entryOf(a).witness);
    await Promise.resolve(); // a later job, no collection in between
    const c = mountedThenUnmounted("C");
    expect(entryOf(c).witness).toBe(entryOf(a).witness);

    simulateGc(mods); // frees it: A, B and C are all judged by this collection
    expect(flagged()).toEqual(["A", "B", "C"]);
    const d = mountedThenUnmounted("D");
    expect(entryOf(d).witness).not.toBeNull();
    expect(entryOf(d).witness).not.toBe(entryOf(a).witness);
    expect(flagged()).toEqual(["A", "B", "C"]); // D: not judged yet
    simulateGc(mods);
    expect(flagged()).toEqual(["A", "B", "C", "D"]);
  });

  it("a burst of unmounts between two collections is judged by the next one", async () => {
    mods.config.configure({ leakAgeMs: 0 });
    for (let i = 0; i < 50; i++) {
      mountedThenUnmounted(`C${i}`);
      await Promise.resolve(); // each in a job of its own
    }
    simulateGc(mods);
    expect(flagged()).toHaveLength(50);
  });

  it("one collection per unmount, indefinitely: the stock never runs dry", async () => {
    mods.config.configure({ leakAgeMs: 0 });
    for (let i = 0; i < 30; i++) {
      const instance = mountedThenUnmounted(`C${i}`);
      expect(entryOf(instance).witness).not.toBeNull();
      await Promise.resolve();
      simulateGc(mods);
    }
    expect(flagged()).toHaveLength(30);
  });

  it("drops the witness on remount (StrictMode cleanup/re-run, <Activity> shown)", () => {
    mods.config.configure({ leakAgeMs: 0 });
    const instance = mountedThenUnmounted("Card");
    mods.lifecycle.markMounted(instance);
    expect(entryOf(instance).witness).toBeNull();
    simulateGc(mods);
    expect(flagged()).toEqual([]);
    expect(rowOf("Card")).toMatchObject({ stale: 0, awaitingGc: 0 });

    // Hidden again: only a collection from now on counts.
    mods.lifecycle.markUnmounted(instance);
    expect(flagged()).toEqual([]);
    simulateGc(mods);
    expect(flagged()).toEqual(["Card"]);
  });

  it("drops the witness when leakAgeMs is raised above the instance's age", () => {
    const instance = makeStaleInstance(mods, "Card");
    mods.sweep.sweep();
    expect(entryOf(instance).witness).not.toBeNull();
    mods.config.configure({ leakAgeMs: 10_000_000 });
    mods.sweep.sweep();
    expect(entryOf(instance).witness).toBeNull();
    simulateGc(mods);
    expect(flagged()).toEqual([]);
    expect(rowOf("Card")).toMatchObject({ stale: 0, awaitingGc: 0 });
  });

  // A witness must be in the old generation, which only a major collection
  // frees: a minor one can free a young object while a cleaned-up marker
  // survives it (dead DOM-side records still point at it). Objects are held
  // through two collections before they can be one.
  it("right after install, waits until a witness has been held through two collections", () => {
    load({ seasoned: false });
    mods.config.configure({ leakAgeMs: 0 });
    const instance = mountedThenUnmounted("Card");
    expect(entryOf(instance).witness).toBeNull();
    expect(rowOf("Card")).toMatchObject({ stale: 0, awaitingGc: 1 });

    simulateGc(mods);
    expect(entryOf(instance).witness).toBeNull();
    expect(flagged()).toEqual([]);
    simulateGc(mods);
    // Seasoned: handed to the waiting instance by the collection count itself.
    expect(entryOf(instance).witness).not.toBeNull();
    expect(flagged()).toEqual([]);
    simulateGc(mods);
    expect(flagged()).toEqual(["Card"]);
  });

  it("waiting instances are handed a witness together once one is seasoned", () => {
    load({ seasoned: false });
    mods.config.configure({ leakAgeMs: 0 });
    const a = mountedThenUnmounted("A");
    const b = mountedThenUnmounted("B");
    simulateGc(mods);
    simulateGc(mods);
    expect(entryOf(a).witness).not.toBeNull();
    expect(entryOf(a).witness).toBe(entryOf(b).witness);
    simulateGc(mods);
    expect(flagged()).toEqual(["A", "B"]);
  });

  it("an instance remounted while waiting for a witness stops waiting", () => {
    load({ seasoned: false });
    mods.config.configure({ leakAgeMs: 0 });
    const instance = mountedThenUnmounted("Card");
    mods.lifecycle.markMounted(instance);
    simulateGc(mods);
    simulateGc(mods);
    expect(entryOf(instance).witness).toBeNull();
    simulateGc(mods);
    expect(flagged()).toEqual([]);
  });
});
