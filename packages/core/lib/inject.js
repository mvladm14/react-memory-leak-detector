/**
 * Framework-agnostic marker-injection mechanics for the Oxc engines.
 *
 * The React and Vue engines differ in *what* they inject (React stabilizes the
 * marker with useRef and drives lifecycle via useEffect; Vue uses a plain const
 * and onMounted/onUnmounted) and in *how they parse* (whole file vs. SFC script
 * block). But the splicing itself — put a marker block at the top of each
 * instrumented function body, and `_heap_ && 0;` at the top of every nested
 * closure so V8 captures the marker into the closure scope chain — is identical.
 * That shared mechanic lives here.
 *
 * All offsets are shifted by `baseOffset`, which lets the Vue engine parse a
 * `<script setup>` substring (offsets relative to the block) yet splice into a
 * `magic-string` of the whole `.vue` file (offsets relative to the file).
 */
const { FUNCTION_TYPES } = require("./walk");

/**
 * The closure-capture no-op. `_heap_ && 0` (not `void _heap_`, which esbuild
 * strips as dead code) forces V8 to keep `_heap_` in the nested closure's scope
 * chain, so a leaking closure retains the searchable `$Heap` marker.
 */
const CLOSURE_CAPTURE = "_heap_ && 0;";

/**
 * The `typeof window !== "undefined" && window.__heapTracker && window.__heapTracker.<method>(<args>)`
 * guard used by every injected tracker call.
 */
function trackerCall(method, args) {
  return `typeof window !== "undefined" && window.__heapTracker && window.__heapTracker.${method}(${args})`;
}

/**
 * Prepend `text` inside a function body via `magic-string`, handling expression
 * bodies. `baseOffset` is added to every AST offset (0 for whole-file parses).
 */
function prependInBody(s, fnNode, text, baseOffset = 0) {
  const body = fnNode.body;
  if (body.type === "BlockStatement") {
    s.appendLeft(baseOffset + body.start + 1, text);
  } else {
    // Expression body: `=> expr` → `=> { <text> return expr; }`
    s.appendLeft(baseOffset + body.start, `{ ${text} return `);
    s.appendLeft(baseOffset + body.end, "; }");
  }
}

/**
 * Walk `program` and splice markers/closure captures into `s` (a MagicString).
 *
 * - For each function node present in `instrumented` (a Map<node, {name, withEffect}>),
 *   inject `markerSource(name, withEffect)` at the top of its body and treat its
 *   descendants as "inside an instrumented function" (depth + 1).
 * - For every other function node nested at depth > 0, inject `_heap_ && 0;`.
 *
 * The traversal mirrors `walk()` but threads a depth counter, so it's inlined
 * here rather than reusing `walk`.
 */
function spliceMarkers(s, program, instrumented, { markerSource, baseOffset = 0 }) {
  const inject = (node, depth) => {
    let childDepth = depth;
    if (FUNCTION_TYPES.has(node.type)) {
      const hit = instrumented.get(node);
      if (hit) {
        prependInBody(s, node, markerSource(hit.name, hit.withEffect), baseOffset);
        childDepth = depth + 1;
      } else if (depth > 0) {
        prependInBody(s, node, CLOSURE_CAPTURE, baseOffset);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c.type === "string") inject(c, childDepth);
        }
      } else if (child && typeof child.type === "string") {
        inject(child, childDepth);
      }
    }
  };
  inject(program, 0);
}

module.exports = { CLOSURE_CAPTURE, trackerCall, prependInBody, spliceMarkers };
