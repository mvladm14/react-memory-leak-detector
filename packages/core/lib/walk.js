/**
 * Framework-agnostic ESTree walking, shared by the Oxc-based engines.
 *
 * Both the React (`../engine-oxc.js`) and Vue (`../engine-vue.js`) engines parse
 * with `oxc-parser` into an ESTree AST and need the same generic pre-order walk
 * to find functions and their nested closures. Keeping it here means the two
 * engines traverse identically.
 */

/** The three node types that introduce a new function scope. */
const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/**
 * Generic ESTree walk. `visit(node, parent)` runs in pre-order. Skips the
 * non-node bookkeeping keys (`type`/`start`/`end`) and recurses into arrays and
 * child nodes alike.
 */
function walk(node, parent, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c.type === "string") walk(c, node, visit);
      }
    } else if (child && typeof child.type === "string") {
      walk(child, node, visit);
    }
  }
}

module.exports = { walk, FUNCTION_TYPES };
