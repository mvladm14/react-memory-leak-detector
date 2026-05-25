import { loadRuntime, type RuntimeModules } from "./helpers";

describe("lifecycle", () => {
  let mods: RuntimeModules;

  beforeEach(() => {
    mods = loadRuntime();
  });

  it("track registers an entry in live, instanceToEntry, and stats", () => {
    const instance = {};
    mods.lifecycle.track(instance, "Card");
    expect(mods.store.live.size).toBe(1);
    const entry = mods.store.instanceToEntry.get(instance);
    expect(entry).toBeDefined();
    expect(entry!.componentName).toBe("Card");
    expect(entry!.mountCount).toBe(0);
    expect(entry!.unmountedAt).toBeNull();
    expect(entry!.ref.deref()).toBe(instance);
    expect(mods.store.getStats("Card").lastRegisteredAt).toBeGreaterThan(0);
  });

  it("markMounted increments mountCount and clears unmountedAt", () => {
    const instance = {};
    mods.lifecycle.track(instance, "Card");
    mods.lifecycle.markMounted(instance);
    const entry = mods.store.instanceToEntry.get(instance)!;
    expect(entry.mountCount).toBe(1);
    expect(entry.unmountedAt).toBeNull();
  });

  it("markUnmounted sets unmountedAt only when mountCount returns to 0", () => {
    const instance = {};
    mods.lifecycle.track(instance, "Card");
    mods.lifecycle.markMounted(instance);
    mods.lifecycle.markMounted(instance); // mountCount=2 (e.g. duplicate registration scenario)
    mods.lifecycle.markUnmounted(instance);
    const entry = mods.store.instanceToEntry.get(instance)!;
    expect(entry.mountCount).toBe(1);
    expect(entry.unmountedAt).toBeNull();
    mods.lifecycle.markUnmounted(instance);
    expect(entry.mountCount).toBe(0);
    expect(entry.unmountedAt).not.toBeNull();
  });

  it("handles the React StrictMode mount→unmount→mount cycle", () => {
    // Effect double-invoke: run → cleanup → run. End state should be mounted.
    const instance = {};
    mods.lifecycle.track(instance, "Card");
    mods.lifecycle.markMounted(instance);
    mods.lifecycle.markUnmounted(instance);
    mods.lifecycle.markMounted(instance);
    const entry = mods.store.instanceToEntry.get(instance)!;
    expect(entry.mountCount).toBe(1);
    expect(entry.unmountedAt).toBeNull();
  });

  it("markUnmounted with mountCount=0 is a no-op", () => {
    const instance = {};
    mods.lifecycle.track(instance, "Card");
    mods.lifecycle.markUnmounted(instance);
    const entry = mods.store.instanceToEntry.get(instance)!;
    expect(entry.mountCount).toBe(0);
    expect(entry.unmountedAt).toBeNull();
  });

  it("markMounted / markUnmounted on an untracked instance is a no-op", () => {
    expect(() => mods.lifecycle.markMounted({})).not.toThrow();
    expect(() => mods.lifecycle.markUnmounted({})).not.toThrow();
  });
});
