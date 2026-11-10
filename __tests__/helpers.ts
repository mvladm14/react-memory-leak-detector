// Shared test helper: re-loads the runtime modules with fresh state.
//
// The runtime modules hold module-level singletons (the live set, listener set,
// _config object). Without isolation each test would see leftovers from the
// previous one. Calling `loadRuntime()` in beforeEach gives every test its own
// instances while preserving the cross-module references (lifecycle, sweep,
// and subscribers all share the same store / config copy).

export type RuntimeModules = {
  config: typeof import("../src/config");
  store: typeof import("../src/store");
  subscribers: typeof import("../src/subscribers");
  lifecycle: typeof import("../src/lifecycle");
  sweep: typeof import("../src/sweep");
  witness: typeof import("../src/witness");
};

export function loadRuntime({ seasoned = true } = {}): RuntimeModules {
  let mods!: RuntimeModules;
  jest.isolateModules(() => {
    mods = {
      config: require("../src/config"),
      store: require("../src/store"),
      subscribers: require("../src/subscribers"),
      lifecycle: require("../src/lifecycle"),
      sweep: require("../src/sweep"),
      witness: require("../src/witness"),
    };
  });
  // A page that has been running for a while: the runtime's whole witness
  // stock has been held through enough collections (src/witness.ts). Tests
  // about that seasoning pass `seasoned: false`.
  if (seasoned) for (let i = 0; i < 3; i++) mods.witness.noteGc();
  return mods;
}

/** A WeakRef whose target has been collected. */
const collected = { deref: () => undefined } as unknown as WeakRef<object>;

/**
 * Stand-in for one major garbage collection in the unit suites, which have
 * no real gc(): every released witness is collected, then the collection is
 * counted (src/witness.ts). Markers are left alone, as if each one were still
 * referenced: the leak a real collection would expose.
 */
export function simulateGc(mods: RuntimeModules): void {
  mods.store.live.forEach((entry) => {
    if (entry.witness) entry.witness.ref = collected;
  });
  // After the collection, as the probe's finalizer runs: a witness this count
  // releases was not collected by it.
  mods.witness.noteGc();
}
