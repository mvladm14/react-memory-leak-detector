// Whether the Oxc engine's native dependencies can actually run in this
// environment.
//
// `oxc-parser` requires Node `^20.19.0 || >=22.12.0` and ships prebuilt native
// bindings. It's an optionalDependency, so on older Node (e.g. the CI Node 18
// leg) npm skips installing it. Tests that FORCE `engine: "oxc"` — or assume
// the auto-detected default is Oxc — can't run there, so they gate on this flag
// and report as skipped instead of failing. Suites that only use
// `engine: "babel"` need no gate.
//
// We gate on BOTH resolvability AND the Node version matching oxc-parser's
// declared engines. The version check matters because a node_modules installed
// under a newer Node can linger when the tests are later run under an older one
// (the native binding's ABI wouldn't load), and following the declared engines
// keeps this in lockstep with what the plugin's own auto-detect will do.

/** Matches oxc-parser's `engines`: ^20.19.0 || >=22.12.0. */
function nodeSupportsOxc() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major === 20) return minor >= 19;
  if (major === 22) return minor >= 12;
  if (major >= 23) return true; // >=22.12 covers 23+
  return false; // <20.19, 21.x, and 22.0–22.11 are excluded by the range
}

function resolvable() {
  try {
    require.resolve("oxc-parser");
    require.resolve("magic-string");
    return true;
  } catch {
    return false;
  }
}

const oxcAvailable = nodeSupportsOxc() && resolvable();

module.exports = { oxcAvailable };
