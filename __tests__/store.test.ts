import { loadRuntime, type RuntimeModules } from "./helpers";

describe("store", () => {
  let mods: RuntimeModules;

  beforeEach(() => {
    mods = loadRuntime();
  });

  it("getStats lazily creates an entry then returns the same one", () => {
    const a = mods.store.getStats("Foo");
    const b = mods.store.getStats("Foo");
    expect(a).toBe(b);
    expect(a).toMatchObject({ lastRegisteredAt: 0, lastWarnedAt: 0 });
  });

  it("getStats returns independent entries for different names", () => {
    const foo = mods.store.getStats("Foo");
    const bar = mods.store.getStats("Bar");
    expect(foo).not.toBe(bar);
  });

  it("exposes empty collections on a fresh load", () => {
    expect(mods.store.live.size).toBe(0);
    expect(mods.store.stats.size).toBe(0);
    expect(mods.store.registry).toBeInstanceOf(FinalizationRegistry);
  });
});
