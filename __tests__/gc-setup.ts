// Runs before each gc test file (jest `setupFiles` for the "gc" project).
//
// 1. Expose a real V8 gc() on the global WITHOUT Node's --expose-gc CLI flag, so
//    the whole suite runs under a plain `jest` invocation. This matters because
//    the unit suites assert on `window.gc` being ABSENT — passing --expose-gc
//    process-wide would make it present (and non-configurable) and break them.
//    Here gc is exposed only in the gc project's workers.
// 2. Turn the tracker's logging off before the runtime loads (config.ts reads
//    window.__heapTrackerOptions at import), suppressing its one-time install log.

const v8 = require("v8") as typeof import("v8");
const vm = require("vm") as typeof import("vm");

const globalWithGc = globalThis as typeof globalThis & { gc?: () => void };
if (typeof globalWithGc.gc !== "function") {
  v8.setFlagsFromString("--expose-gc");
  globalWithGc.gc = vm.runInNewContext("gc") as () => void;
  v8.setFlagsFromString("--no-expose-gc");
}

(
  window as typeof window & { __heapTrackerOptions?: { logging?: boolean } }
).__heapTrackerOptions = { logging: false };
