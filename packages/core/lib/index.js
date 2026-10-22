/**
 * `@memleak/core` build-time AST barrel.
 *
 * Re-exports the framework-agnostic build-time machinery — the ESTree walk, the
 * marker/closure splicing, the runtime-config source, and the detection
 * predicates — so the per-framework adapters (`@memleak/react`, `@memleak/vue`)
 * import everything they share from one place: `require("@memleak/core")`.
 */
module.exports = {
  ...require("./walk"),
  ...require("./inject"),
  ...require("./config-source"),
  ...require("./predicates"),
};
