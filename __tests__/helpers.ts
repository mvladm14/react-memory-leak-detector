// Shared test helper: re-loads the runtime modules with fresh state.
//
// The runtime modules hold module-level singletons (the live set, listener set,
// _config object). Without isolation each test would see leftovers from the
// previous one. Calling `loadRuntime()` in beforeEach gives every test its own
// instances while preserving the cross-module references (lifecycle, sweep,
// and subscribers all share the same store / config copy).

export type RuntimeModules = {
  config: typeof import("../packages/core/src/config");
  store: typeof import("../packages/core/src/store");
  subscribers: typeof import("../packages/core/src/subscribers");
  lifecycle: typeof import("../packages/core/src/lifecycle");
  sweep: typeof import("../packages/core/src/sweep");
};

export function loadRuntime(): RuntimeModules {
  let mods!: RuntimeModules;
  jest.isolateModules(() => {
    mods = {
      config: require("../packages/core/src/config"),
      store: require("../packages/core/src/store"),
      subscribers: require("../packages/core/src/subscribers"),
      lifecycle: require("../packages/core/src/lifecycle"),
      sweep: require("../packages/core/src/sweep"),
    };
  });
  return mods;
}
