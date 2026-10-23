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

  // Late adoption: the runtime is normally loaded with a fire-and-forget
  // dynamic import() that resolves after React's first commit, so components
  // in the initial tree call track() into a missing tracker and never retry.
  // The first markMounted / markUnmounted the runtime sees for such a marker
  // must adopt it, recovering the name from the `Name$Heap` constructor.
  describe("adoption of instances rendered before the runtime loaded", () => {
    // Same shape the babel plugin / oxc engine inject:
    //   new (function ComponentName$Heap() {})()
    const makeMarker = (name: string): object =>
      new (new Function(`return function ${name}$Heap() {};`)())();

    it("markMounted adopts an unknown marker and mounts it", () => {
      const instance = makeMarker("AppShell");
      mods.lifecycle.markMounted(instance);

      const entry = mods.store.instanceToEntry.get(instance);
      expect(entry).toBeDefined();
      expect(entry!.componentName).toBe("AppShell");
      expect(entry!.mountCount).toBe(1);
      expect(entry!.unmountedAt).toBeNull();
      expect(entry!.ref.deref()).toBe(instance);
      expect(mods.store.live.has(entry!)).toBe(true);
      expect(mods.store.live.size).toBe(1);
      expect(mods.store.getStats("AppShell").lastRegisteredAt).toBeGreaterThan(
        0,
      );
    });

    it("markUnmounted adopts an unknown marker as already unmounted", () => {
      const before = Date.now();
      const instance = makeMarker("LandingRoute");
      mods.lifecycle.markUnmounted(instance);

      const entry = mods.store.instanceToEntry.get(instance);
      expect(entry).toBeDefined();
      expect(entry!.componentName).toBe("LandingRoute");
      expect(entry!.mountCount).toBe(0);
      // Sweepable: unmountedAt is set even though no mount was ever seen.
      expect(entry!.unmountedAt).not.toBeNull();
      expect(entry!.unmountedAt!).toBeGreaterThanOrEqual(before);
      expect(mods.store.live.size).toBe(1);
      expect(
        mods.store.getStats("LandingRoute").lastRegisteredAt,
      ).toBeGreaterThan(0);
    });

    it("an adopted-on-unmount marker is reported as stale by sweep/report", () => {
      mods.config.configure({
        leakAgeMs: 0,
        suspectThreshold: 1,
        warnCooldownMs: 0,
        logging: false,
      });
      const events: string[] = [];
      mods.subscribers.subscribe((e) => events.push(e.component));

      const instance = makeMarker("Layout");
      mods.lifecycle.markUnmounted(instance);
      mods.sweep.sweep();

      expect(events).toEqual(["Layout"]);
      const row = mods.sweep.report().find((r) => r.component === "Layout");
      expect(row).toEqual(
        expect.objectContaining({ component: "Layout", live: 1, stale: 1 }),
      );
    });

    it("keeps the StrictMode cycle intact when the runtime arrives mid-commit", () => {
      // track() was missed; the tracker shows up before the effects run:
      // run → cleanup → run must end mounted, exactly as for a tracked marker.
      const instance = makeMarker("Card");
      mods.lifecycle.markMounted(instance);
      mods.lifecycle.markUnmounted(instance);
      mods.lifecycle.markMounted(instance);
      const entry = mods.store.instanceToEntry.get(instance)!;
      expect(entry.componentName).toBe("Card");
      expect(entry.mountCount).toBe(1);
      expect(entry.unmountedAt).toBeNull();
    });

    it("adopts the same marker only once", () => {
      const instance = makeMarker("Card");
      mods.lifecycle.markMounted(instance);
      const entry = mods.store.instanceToEntry.get(instance)!;
      mods.lifecycle.markMounted(instance);
      expect(mods.store.instanceToEntry.get(instance)).toBe(entry);
      expect(entry.mountCount).toBe(2);
      expect(mods.store.live.size).toBe(1);
    });

    it("derives the name from the constructor, falling back to Unknown", () => {
      expect(mods.lifecycle.componentNameOf(makeMarker("Header"))).toBe(
        "Header",
      );
      // A named constructor without the marker suffix is used as-is.
      class Widget {}
      expect(mods.lifecycle.componentNameOf(new Widget())).toBe("Widget");
      // No usable constructor name at all.
      expect(mods.lifecycle.componentNameOf(Object.create(null))).toBe(
        "Unknown",
      );
      expect(
        mods.lifecycle.componentNameOf(new (function () {} as any)()),
      ).toBe("Unknown");

      mods.lifecycle.markMounted(Object.create(null));
      expect(mods.store.getStats("Unknown").lastRegisteredAt).toBeGreaterThan(
        0,
      );
    });

    it("does not throw on a plain object", () => {
      expect(() => mods.lifecycle.markMounted({})).not.toThrow();
      expect(() => mods.lifecycle.markUnmounted({})).not.toThrow();
    });
  });
});
