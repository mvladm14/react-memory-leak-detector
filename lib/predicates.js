/**
 * Shared, engine-agnostic detection predicates for the heap-markers plugins.
 *
 * These are pure string/RegExp helpers with no dependency on any particular
 * AST library, so both the Babel engine (`babel-plugin.js`) and the Oxc engine
 * (`lib/engine-oxc.js`) can use the exact same rules for deciding what counts
 * as a component, a hook, or an instrumentable file. Keeping them in one place
 * ensures the two engines never drift apart.
 */

/** PascalCase identifier — the component-name convention. */
function isPascalCase(name) {
  return /^[A-Z]\w*$/.test(name);
}

/**
 * Custom hook — `use` followed by an uppercase letter (useEffect, useMyHook).
 * Excludes the bare identifier `use`.
 */
function isCustomHook(name) {
  return /^use[A-Z]/.test(name);
}

/** True if `name` matches any RegExp in `excludeNames`. */
function isExcludedName(name, excludeNames) {
  return excludeNames.some((re) => re.test(name));
}

/**
 * Components must live in a JSX/TSX file AND satisfy the caller's `include`.
 * (`include` is the plugin-wide file gate; we narrow it to JSX extensions for
 * component detection only — hooks may live in any JS/TS file.)
 */
function isReactFile(filename, include) {
  const f = filename || "";
  return /\.[tj]sx$/.test(f) && include.test(f);
}

/** Any JS/TS/JSX/TSX file matching the caller's `include`. */
function isJSOrTSFile(filename, include) {
  return include.test(filename || "");
}

module.exports = {
  isPascalCase,
  isCustomHook,
  isExcludedName,
  isReactFile,
  isJSOrTSFile,
};
