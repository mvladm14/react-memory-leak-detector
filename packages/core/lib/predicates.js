/**
 * Detection predicates shared by every engine.
 *
 * Pure string/RegExp helpers with no dependency on any AST library. They encode
 * the naming/file conventions shared across the engines (Babel, Oxc-React,
 * Oxc-Vue) so the engines can't drift on what counts as a component, a
 * hook/composable, or an instrumentable file.
 *
 * `isReactFile` is React-specific but lives here too: it's cheap, framework
 * detection is a string test, and keeping all the predicates in one core module
 * means the React adapter imports everything from `@memleak/core` rather than
 * carrying its own predicate wrapper.
 */

/** PascalCase identifier — the component-name convention (React and Vue). */
function isPascalCase(name) {
  return /^[A-Z]\w*$/.test(name);
}

/**
 * Custom hook / composable — `use` followed by an uppercase letter
 * (useEffect, useMyHook, useMouse). Excludes the bare identifier `use`.
 * Shared: React hooks and Vue composables use the identical convention.
 */
function isCustomHook(name) {
  return /^use[A-Z]/.test(name);
}

/** True if `name` matches any RegExp in `excludeNames`. */
function isExcludedName(name, excludeNames) {
  return excludeNames.some((re) => re.test(name));
}

/** Any file matching the caller's `include` gate. */
function isJSOrTSFile(filename, include) {
  return include.test(filename || "");
}

/**
 * React components must live in a JSX/TSX file AND satisfy the caller's
 * `include`. (`include` is the plugin-wide file gate; we narrow it to JSX
 * extensions for component detection only — hooks may live in any JS/TS file.)
 */
function isReactFile(filename, include) {
  const f = filename || "";
  return /\.[tj]sx$/.test(f) && include.test(f);
}

module.exports = {
  isPascalCase,
  isCustomHook,
  isExcludedName,
  isJSOrTSFile,
  isReactFile,
};
