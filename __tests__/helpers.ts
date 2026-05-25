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
};

export function loadRuntime(): RuntimeModules {
  let mods!: RuntimeModules;
  jest.isolateModules(() => {
    mods = {
      config: require("../src/config"),
      store: require("../src/store"),
      subscribers: require("../src/subscribers"),
      lifecycle: require("../src/lifecycle"),
      sweep: require("../src/sweep"),
    };
  });
  return mods;
}
