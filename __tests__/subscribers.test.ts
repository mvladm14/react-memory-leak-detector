import { loadRuntime, type RuntimeModules } from "./helpers";
import type { LeakEvent } from "../src/types";

const sampleEvent: LeakEvent = {
  component: "Card",
  stale: 2,
  live: 3,
  leakAgeMs: 10_000,
  at: 1_700_000_000_000,
};

describe("subscribers", () => {
  let mods: RuntimeModules;

  beforeEach(() => {
    mods = loadRuntime();
  });

  it("hasListeners reflects current subscription count", () => {
    expect(mods.subscribers.hasListeners()).toBe(false);
    const unsub = mods.subscribers.subscribe(() => {});
    expect(mods.subscribers.hasListeners()).toBe(true);
    unsub();
    expect(mods.subscribers.hasListeners()).toBe(false);
  });

  it("subscribe returns an unsubscribe function", () => {
    const cb = jest.fn();
    const unsub = mods.subscribers.subscribe(cb);
    mods.subscribers.emitLeak(sampleEvent);
    expect(cb).toHaveBeenCalledWith(sampleEvent);
    unsub();
    mods.subscribers.emitLeak(sampleEvent);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("emitLeak fans out to every subscriber", () => {
    const a = jest.fn();
    const b = jest.fn();
    mods.subscribers.subscribe(a);
    mods.subscribers.subscribe(b);
    mods.subscribers.emitLeak(sampleEvent);
    expect(a).toHaveBeenCalledWith(sampleEvent);
    expect(b).toHaveBeenCalledWith(sampleEvent);
  });

  it("a throwing listener does not prevent other listeners from firing", () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const bad = jest.fn(() => {
      throw new Error("boom");
    });
    const good = jest.fn();
    mods.subscribers.subscribe(bad);
    mods.subscribers.subscribe(good);
    mods.subscribers.emitLeak(sampleEvent);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("listener errors are silenced when logging is disabled", () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mods.config.configure({ logging: false });
    mods.subscribers.subscribe(() => {
      throw new Error("boom");
    });
    mods.subscribers.emitLeak(sampleEvent);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
