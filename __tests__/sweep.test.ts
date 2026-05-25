import { loadRuntime, type RuntimeModules } from "./helpers";
import type { LeakEvent } from "../src/types";

/**
 * Helper: tracks an instance and forces it into the "stale" state by setting
 * its unmountedAt deep in the past, so the next sweep treats it as a leak
 * regardless of how long the test has been running.
 */
function makeStaleInstance(mods: RuntimeModules, name: string): object {
  const instance = {};
  mods.lifecycle.track(instance, name);
  mods.lifecycle.markMounted(instance);
  mods.lifecycle.markUnmounted(instance);
  const entry = mods.store.instanceToEntry.get(instance)!;
  entry.unmountedAt = Date.now() - 1_000_000;
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

  it("warns and emits a LeakEvent for stale entries", () => {
    const events: LeakEvent[] = [];
    mods.subscribers.subscribe((e) => events.push(e));
    makeStaleInstance(mods, "Card");
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
    makeStaleInstance(mods, "Card");
    makeStaleInstance(mods, "Card");
    mods.sweep.sweep();
    expect(listener).not.toHaveBeenCalled();
    // Add a third to cross the threshold.
    makeStaleInstance(mods, "Card");
    mods.sweep.sweep();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ component: "Card", stale: 3 }),
    );
  });

  it("respects warnCooldownMs (no duplicate fire within cooldown)", () => {
    const listener = jest.fn();
    mods.subscribers.subscribe(listener);
    makeStaleInstance(mods, "Card");
    mods.sweep.sweep();
    mods.sweep.sweep();
    mods.sweep.sweep();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("fires again after the cooldown elapses", () => {
    mods.config.configure({ warnCooldownMs: 50 });
    const listener = jest.fn();
    mods.subscribers.subscribe(listener);
    makeStaleInstance(mods, "Card");

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
    makeStaleInstance(mods, "Card");
    mods.sweep.sweep();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("report returns rows sorted by stale desc, then live desc", () => {
    // 1 stale Card; 2 live (mounted) Banner; 1 stale + 1 mounted Modal.
    makeStaleInstance(mods, "Card");

    const b1 = {};
    const b2 = {};
    mods.lifecycle.track(b1, "Banner");
    mods.lifecycle.markMounted(b1);
    mods.lifecycle.track(b2, "Banner");
    mods.lifecycle.markMounted(b2);

    makeStaleInstance(mods, "Modal");
    const m2 = {};
    mods.lifecycle.track(m2, "Modal");
    mods.lifecycle.markMounted(m2);

    const rows = mods.sweep.report();
    // Modal: 1 stale, 2 live. Card: 1 stale, 1 live. Banner: 0 stale, 2 live.
    expect(rows.map((r) => r.component)).toEqual(["Modal", "Card", "Banner"]);
    expect(rows[0]).toMatchObject({ component: "Modal", stale: 1, live: 2 });
  });

  it("forceGc logs an info message when window.gc is unavailable and still sweeps", () => {
    // jsdom has no window.gc → should hit the "not available" branch.
    makeStaleInstance(mods, "Card");
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
