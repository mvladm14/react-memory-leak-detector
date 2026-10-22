/**
 * Framework-agnostic runtime-config injection for the Oxc engines.
 *
 * When any runtime option is non-default, the engines prepend a small block that
 * sets `window.__heapTrackerOptions` and calls `configure()` so the runtime picks
 * up the caller's settings. The React and Vue engines emit the identical block.
 */

/** Default runtime options; a value differing from these triggers config emit. */
const DEFAULTS = {
  logging: true,
  leakAgeMs: 10000,
  suspectThreshold: 1,
  sweepIntervalMs: 2000,
  warnCooldownMs: 30000,
};

/** True if any of `opts` differs from the defaults (so a config block is needed). */
function emitsConfig(opts) {
  return (
    opts.logging === false ||
    opts.leakAgeMs !== DEFAULTS.leakAgeMs ||
    opts.suspectThreshold !== DEFAULTS.suspectThreshold ||
    opts.sweepIntervalMs !== DEFAULTS.sweepIntervalMs ||
    opts.warnCooldownMs !== DEFAULTS.warnCooldownMs
  );
}

/**
 * The runtime-config block, matching the Babel plugin's Program-exit injection.
 * The spacing (`leakAgeMs: 5000`, comma-space) is chosen so the emitted text is
 * byte-identical to the Babel engine's output, which the parity tests assert on.
 */
function configSource(opts) {
  const o = JSON.stringify({
    logging: opts.logging,
    leakAgeMs: opts.leakAgeMs,
    suspectThreshold: opts.suspectThreshold,
    sweepIntervalMs: opts.sweepIntervalMs,
    warnCooldownMs: opts.warnCooldownMs,
  })
    .replace(/"(\w+)":/g, "$1: ")
    .replace(/,/g, ", ");
  return (
    `if (typeof window !== "undefined") {` +
    `window.__heapTrackerOptions = ${o};` +
    `window.__heapTracker && window.__heapTracker.configure(window.__heapTrackerOptions);` +
    `}`
  );
}

module.exports = { DEFAULTS, emitsConfig, configSource };
