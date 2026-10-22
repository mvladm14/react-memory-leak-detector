/**
 * Oxc engine (React) for the memory-leak detector's Vite plugin.
 *
 * Same job as the Babel engine (`engine-babel.js`) — inject heap markers into
 * React components/hooks in an `enforce: "pre"` transform hook — but built
 * natively for Oxc instead of shelling out to a second full compiler:
 *
 *   1. Parse with `oxc-parser` → an ESTree AST with byte-accurate `start`/`end`
 *      offsets. Oxc parses TS/JSX/decorators natively, so there is no
 *      `parserPlugins` foot-gun.
 *   2. Walk the AST in JS to find components/hooks and their nested closures.
 *   3. Splice the marker code in with `magic-string` at the relevant offsets.
 *      The original bytes are preserved untouched (JSX/TS included) and the
 *      sourcemap falls out for free — no reprint, unlike the Babel engine.
 *
 * The *injected code shapes* are identical to the Babel plugin, so the runtime
 * tracker and heap-snapshot workflow are unchanged. See `./babel-plugin.js`
 * for the rationale behind each injected construct (useRef-stabilized marker,
 * `_heap_ && 0` closure capture, unmount effect).
 *
 * The generic machinery (ESTree walk, marker/closure splicing, runtime-config
 * block) lives in `@memleak/core` and is shared with the Vue engine
 * (`@memleak/vue`); only React's detection rules and marker/lifecycle shape
 * live here.
 *
 * Requires `oxc-parser` and `magic-string`.
 */
const {
  isPascalCase,
  isCustomHook,
  isExcludedName,
  isReactFile,
  isJSOrTSFile,
  walk,
  trackerCall,
  spliceMarkers,
  emitsConfig,
  configSource,
} = require("@memleak/core");

// `oxc-parser` and `magic-string` are ESM-only packages. Loading them from this
// CommonJS module with `require()` only works on Node ≥20.19 / ≥22.12 (which
// support `require(esm)`); on older Node — still within this package's supported
// range — it throws ERR_REQUIRE_ESM. Dynamic `import()` works everywhere, so we
// lazy-load both once and cache the result. This is why `transform` is async.
// `error.code` set on the failure thrown when oxc-parser/magic-string can't be
// loaded, so the auto-detect dispatcher can fall back to the Babel engine.
const OXC_UNAVAILABLE = "ERR_HEAP_OXC_UNAVAILABLE";

let depsPromise;
function loadDeps() {
  if (!depsPromise) {
    depsPromise = Promise.all([
      import("oxc-parser"),
      import("magic-string"),
    ])
      .then(([oxc, ms]) => ({
        parseSync: oxc.parseSync,
        // magic-string exposes the constructor as both `.default` and `.MagicString`.
        MagicString: ms.default || ms.MagicString,
      }))
      .catch((err) => {
        // `oxc-parser` can resolve on disk yet still fail to load (e.g. no
        // prebuilt native binding for this platform). Don't cache the rejected
        // promise, and surface an actionable message instead of a cryptic
        // module-load error repeated per file — the fix is to force the Babel
        // engine, which has no native dependency.
        depsPromise = undefined;
        const wrapped = new Error(
          '[react-memory-leak-detector] the "oxc" engine failed to load ' +
            "oxc-parser/magic-string; pass engine: \"babel\" to use the " +
            `Babel engine instead. Original error: ${
              (err && err.message) || err
            }`,
        );
        // Tagged so the auto-detect dispatcher in ../vite.js can tell a
        // dependency-load failure (→ fall back to Babel) apart from a real
        // transform error (→ propagate).
        wrapped.code = OXC_UNAVAILABLE;
        throw wrapped;
      });
  }
  return depsPromise;
}

const USE_EFFECT_ALIAS = "__heap_useEffect";
const USE_REF_ALIAS = "__heap_useRef";

// ─── AST helpers ────────────────────────────────────────────────────────────

/** True if a JSX element/fragment appears anywhere inside `fnNode`. */
function containsJSX(fnNode) {
  let found = false;
  walk(fnNode, null, (n) => {
    if (n.type === "JSXElement" || n.type === "JSXFragment") found = true;
  });
  return found;
}

/**
 * Resolves the inner function node from a variable initializer, unwrapping the
 * common component wrappers `memo()` / `forwardRef()` (and their `React.`
 * member forms). Mirrors `resolveComponentFunction` in the Babel plugin.
 */
function resolveComponentFunction(init) {
  if (!init) return null;
  if (
    init.type === "ArrowFunctionExpression" ||
    init.type === "FunctionExpression"
  ) {
    return init;
  }
  if (init.type === "CallExpression") {
    const callee = init.callee;
    let calleeName = null;
    if (callee.type === "Identifier") calleeName = callee.name;
    else if (
      callee.type === "MemberExpression" &&
      callee.property.type === "Identifier"
    ) {
      calleeName = callee.property.name;
    }
    if (calleeName === "memo" || calleeName === "forwardRef") {
      const first = init.arguments && init.arguments[0];
      if (!first) return null;
      if (
        first.type === "ArrowFunctionExpression" ||
        first.type === "FunctionExpression"
      ) {
        return first;
      }
      if (first.type === "CallExpression") return resolveComponentFunction(first);
    }
  }
  return null;
}

// ─── Injected source builders ───────────────────────────────────────────────

/** The React marker block injected at the top of a component/hook body. */
function markerSource(name, withUnmountEffect) {
  const marker = `${name}$Heap`;
  let src =
    `var _heap_ref_ = ${USE_REF_ALIAS}(null);` +
    `if (_heap_ref_.current === null) {` +
    `_heap_ref_.current = new (function ${marker}() {})();` +
    trackerCall("track", `_heap_ref_.current, ${JSON.stringify(name)}`) +
    `;}` +
    `var _heap_ = _heap_ref_.current;`;
  if (withUnmountEffect) {
    src +=
      `${USE_EFFECT_ALIAS}(() => {` +
      trackerCall("markMounted", "_heap_") +
      `;return () => ${trackerCall("markUnmounted", "_heap_")};` +
      `}, []);`;
  }
  return src;
}

module.exports = function heapMarkersViteOxc(options = {}) {
  const {
    include = /\.[cm]?[jt]sx?$/,
    exclude,
    apply = "serve",
    // parserPlugins is accepted for API symmetry with the Babel engine but
    // unused: Oxc parses TS/JSX/decorators natively.
    parserPlugins: _parserPlugins,
    excludeNames = [],
    excludeUnmountTracking = [],
    trackHooks = true,
    skipServerComponents = false,
    logging = true,
    leakAgeMs = 10000,
    suspectThreshold = 1,
    sweepIntervalMs = 2000,
    warnCooldownMs = 30000,
  } = options;

  const isExcludedFromUnmountTracking = (name) =>
    excludeUnmountTracking.some((re) => re.test(name));

  const configOpts = {
    logging,
    leakAgeMs,
    suspectThreshold,
    sweepIntervalMs,
    warnCooldownMs,
  };
  const emitConfig = emitsConfig(configOpts);

  return {
    name: "react-memory-leak-detector",
    enforce: "pre",
    apply,
    async transform(code, id) {
      const file = id.split("?", 1)[0];
      if (id.includes("\0") || file.includes("/node_modules/")) return null;
      if (!include.test(file)) return null;
      if (exclude && exclude.test(file)) return null;
      if (!code.includes("react")) return null;

      const { parseSync, MagicString } = await loadDeps();
      const parsed = parseSync(file, code);
      // Bail quietly on parse errors rather than crashing the dev server; the
      // downstream React transformer will surface a proper diagnostic.
      if (parsed.errors && parsed.errors.length) return null;
      const program = parsed.program;

      const fileImportsReact = program.body.some(
        (n) =>
          n.type === "ImportDeclaration" &&
          n.source.value === "react" &&
          n.importKind !== "type",
      );
      if (!fileImportsReact) return null;

      if (skipServerComponents) {
        const hasUseClient = program.body.some(
          (n) => n.type === "ExpressionStatement" && n.directive === "use client",
        );
        if (!hasUseClient) return null;
      }

      // ── Pass 1: detect the component/hook functions to instrument ──
      // Map<functionNode, { name, withEffect }>
      const instrumented = new Map();

      const consider = (name, fnNode, { requireJSX }) => {
        if (!fnNode) return;
        if (requireJSX && !containsJSX(fnNode)) return;
        instrumented.set(fnNode, {
          name,
          withEffect: !isExcludedFromUnmountTracking(name),
        });
      };

      walk(program, null, (node) => {
        if (node.type === "FunctionDeclaration") {
          const name = node.id && node.id.name;
          if (!name || isExcludedName(name, excludeNames)) return;
          if (trackHooks && isCustomHook(name) && isJSOrTSFile(file, include)) {
            consider(name, node, { requireJSX: false });
            return;
          }
          if (!isReactFile(file, include) || !isPascalCase(name)) return;
          consider(name, node, { requireJSX: true });
        } else if (node.type === "VariableDeclarator") {
          const name = node.id && node.id.type === "Identifier" && node.id.name;
          if (!name || isExcludedName(name, excludeNames)) return;
          const isHook = isCustomHook(name) && trackHooks;
          const isComponent = isPascalCase(name);
          if (!isHook && !isComponent) return;
          if (isHook && !isJSOrTSFile(file, include)) return;
          if (!isHook && !isReactFile(file, include)) return;

          let fnNode = null;
          if (isHook) {
            const init = node.init;
            fnNode =
              init &&
              (init.type === "ArrowFunctionExpression" ||
                init.type === "FunctionExpression")
                ? init
                : null;
          } else {
            fnNode = resolveComponentFunction(node.init);
          }
          consider(name, fnNode, { requireJSX: !isHook });
        }
      });

      if (instrumented.size === 0) {
        // No components/hooks to mark. The Babel engine still injects the
        // runtime-config block on every react-importing file when options are
        // non-default, so match it here rather than skipping the file — keeps
        // the two engines' output equivalent.
        if (!emitConfig) return null;
        const s = new MagicString(code);
        s.prepend(configSource(configOpts) + "\n");
        return {
          code: s.toString(),
          map: s.generateMap({ hires: true, source: file }),
        };
      }

      // ── Pass 2: splice markers + closure captures ──
      const s = new MagicString(code);
      spliceMarkers(s, program, instrumented, { markerSource, baseOffset: 0 });

      const needsUseRef = instrumented.size > 0;
      const needsUseEffect = [...instrumented.values()].some((v) => v.withEffect);

      // ── Prelude: runtime config + aliased react import ──
      const prelude = [];
      const specifiers = [];
      if (needsUseRef) specifiers.push(`useRef as ${USE_REF_ALIAS}`);
      if (needsUseEffect) specifiers.push(`useEffect as ${USE_EFFECT_ALIAS}`);
      if (specifiers.length) {
        // A second `import ... from "react"` is valid ESM and avoids the
        // fragile surgery of editing an existing import's specifier list.
        prelude.push(`import { ${specifiers.join(", ")} } from "react";`);
      }
      if (emitConfig) {
        prelude.push(configSource(configOpts));
      }
      if (prelude.length) s.prepend(prelude.join("\n") + "\n");

      return {
        code: s.toString(),
        map: s.generateMap({ hires: true, source: file }),
      };
    },
  };
};

// Exposed so ../vite.js can identify a dependency-load failure and fall back.
module.exports.OXC_UNAVAILABLE = OXC_UNAVAILABLE;
