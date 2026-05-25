import { loadRuntime, type RuntimeModules } from "./helpers";

describe("config", () => {
  let mods: RuntimeModules;

  beforeEach(() => {
    mods = loadRuntime();
  });

  it("ships sensible defaults", () => {
    expect(mods.config._config).toMatchObject({
      logging: true,
      leakAgeMs: 10_000,
      suspectThreshold: 1,
      sweepIntervalMs: 2_000,
      warnCooldownMs: 30_000,
    });
  });

  it("configure() merges partial updates", () => {
    mods.config.configure({ logging: false, leakAgeMs: 5_000 });
    expect(mods.config._config.logging).toBe(false);
    expect(mods.config._config.leakAgeMs).toBe(5_000);
    // untouched fields remain
    expect(mods.config._config.sweepIntervalMs).toBe(2_000);
  });

  it("notifies onSweepIntervalChange listeners when sweepIntervalMs changes", () => {
    const cb = jest.fn();
    mods.config.onSweepIntervalChange(cb);
    mods.config.configure({ sweepIntervalMs: 500 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does NOT notify listeners when sweepIntervalMs is set to the same value", () => {
    const cb = jest.fn();
    mods.config.onSweepIntervalChange(cb);
    mods.config.configure({ sweepIntervalMs: mods.config._config.sweepIntervalMs });
    expect(cb).not.toHaveBeenCalled();
  });

  it("does NOT notify listeners when other fields change", () => {
    const cb = jest.fn();
    mods.config.onSweepIntervalChange(cb);
    mods.config.configure({ logging: false, leakAgeMs: 1_000 });
    expect(cb).not.toHaveBeenCalled();
  });
});
