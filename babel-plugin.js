/**
 * Babel plugin: babel-plugin-heap-markers
 *
 * Automatically injects a named marker instance into React functional components
 * so they become identifiable in Chrome DevTools heap snapshots.
 *
 * How it works:
 * 1. At the top of each component body, injects a useRef-stabilized marker
 *    that survives across renders (one per component instance, not per
 *    render — otherwise the unmount effect's `[]` deps would only ever
 *    track render-1's marker and miss leaks anchored to later-render
 *    closures):
 *      var _heap_ref_ = __heap_useRef(null);
 *      if (_heap_ref_.current === null) {
 *        _heap_ref_.current = new (function ComponentName$Heap() {})();
 *        window.__heapTracker?.track(_heap_ref_.current, "ComponentName");
 *      }
 *      var _heap_ = _heap_ref_.current;
 *
 * 2. Into every nested closure (arrows, function expressions), injects:
 *      _heap_ && 0;
 *    This forces V8 to capture _heap_ in the closure's scope chain.
 *    (We use `_heap_ && 0` instead of `void _heap_` because esbuild
 *    strips void expressions as dead code.)
 *
 * If a closure leaks (e.g., useEffect without cleanup), the closure retains
 * _heap_, which retains the ComponentName$Heap instance. In heap snapshots:
 * - Search for "ComponentName$Heap" to find the leaked component
 * - Check "Retainers" to see the ACTUAL closure causing the leak
 *
 * Targets:
 * - Named function declarations:   function MyComponent() { ... }
 * - Const arrow functions:          const MyComponent = () => { ... }
 * - Const function expressions:     const MyComponent = function() { ... }
 * - memo-wrapped:                   const MyComponent = memo(() => { ... })
 * - forwardRef-wrapped:             const MyComponent = forwardRef((props, ref) => { ... })
 * - Custom hooks (any file):        function useMyHook() { ... }
 * - Custom hooks (arrow):           const useMyHook = () => { ... }
 *
 * Components: only .tsx/.jsx files, PascalCase names, must contain JSX.
 * Hooks: any .ts/.tsx/.js/.jsx file, use* prefix, no JSX required.
 *
 * Strategy:
 * Instead of using a nested bodyPath.traverse() (which can silently fail in
 * Babel's visitor context), this plugin uses Babel's normal visitor pattern:
 * - Phase 1: FunctionDeclaration/VariableDeclarator visitors detect components,
 *   inject the marker, and register the component function node in a WeakSet.
 * - Phase 2: ArrowFunctionExpression/FunctionExpression visitors run on EVERY
 *   nested function. They check if _heap_ exists in the parent scope chain
 *   and inject `_heap_ && 0` if so. Component-level and marker functions are
 *   skipped via the WeakSet.
 */
/**
 * Plugin options:
 *   include                  — RegExp matched against the file path. Files not
 *                              matching are skipped entirely.
 *                              Default: /\.[tj]sx?$/ (JS/TS/JSX/TSX).
 *   excludeNames             — Array of RegExp matched against the component
 *                              or hook identifier. A match skips ALL
 *                              instrumentation for that one function.
 *                              Default: [].
 *   excludeUnmountTracking   — Array of RegExp matched against the identifier.
 *                              A match keeps the $Heap marker + track() call
 *                              (still searchable in heap snapshots) but skips
 *                              the synthetic useEffect that drives live
 *                              detection. Use this for components managed by
 *                              <Activity mode="hidden">, where cleanup fires
 *                              while the fiber is still alive — otherwise the
 *                              tracker would false-positive.
 *                              Default: [].
 *   trackHooks               — When false, custom hooks (use* names) are NOT
 *                              instrumented; only components are.
 *                              Default: true.
 *   skipServerComponents     — When true, files that don't begin with the
 *                              "use client" directive are skipped entirely.
 *                              Needed in React Server Components projects:
 *                              server components can't call useEffect, so
 *                              injecting it would crash at module-load time.
 *                              Default: false.
 *   logging                  — When false, disables console warnings at runtime
 *                              while still tracking.
 *                              Default: true.
 *
 * Components additionally require a .jsx/.tsx extension and a JSX element in
 * the body — that's structural, not a config option.
 */
module.exports = function babelPluginHeapMarkers({ types: t }, options = {}) {
  const {
    include = /\.[tj]sx?$/,
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

  // Track function nodes that ARE components or hooks (don't inject _heap_ && 0 into them)
  const instrumentedFunctions = new WeakSet();
  // Track function nodes that are marker constructors (don't inject _heap_ && 0)
  const markerConstructors = new WeakSet();

  function isPascalCase(name) {
    return /^[A-Z]\w*$/.test(name);
  }

  function isCustomHook(name) {
    // Matches use + uppercase letter: useEffect, useMyHook, etc.
    // Excludes bare "use"
    return /^use[A-Z]/.test(name);
  }

  function isExcludedName(name) {
    return excludeNames.some((re) => re.test(name));
  }

  function isExcludedFromUnmountTracking(name) {
    return excludeUnmountTracking.some((re) => re.test(name));
  }

  function isReactFile(filename) {
    // Components must live in JSX/TSX files. We narrow the user's `include`
    // to JSX extensions for component detection only.
    return (
      /\.[tj]sx$/.test(filename || "") && include.test(filename || "")
    );
  }

  function isJSOrTSFile(filename) {
    return include.test(filename || "");
  }

  function containsJSX(nodePath) {
    let found = false;
    nodePath.traverse({
      JSXElement(path) {
        found = true;
        path.stop();
      },
      JSXFragment(path) {
        found = true;
        path.stop();
      },
    });
    return found;
  }

  /**
   * Resolves the inner function path from a variable initializer.
   * Handles direct arrow/function expressions and common wrappers
   * like memo() and forwardRef().
   */
  function resolveComponentFunction(initPath) {
    if (
      initPath.isArrowFunctionExpression() ||
      initPath.isFunctionExpression()
    ) {
      return initPath;
    }

    // Handle memo(() => {}), forwardRef(() => {}),
    // React.memo(() => {}), React.forwardRef(() => {})
    if (initPath.isCallExpression()) {
      const callee = initPath.get("callee");
      let calleeName = null;

      if (callee.isIdentifier()) {
        calleeName = callee.node.name;
      } else if (
        callee.isMemberExpression() &&
        callee.get("property").isIdentifier()
      ) {
        calleeName = callee.get("property").node.name;
      }

      if (calleeName === "memo" || calleeName === "forwardRef") {
        const args = initPath.get("arguments");
        if (args.length > 0) {
          const firstArg = args[0];
          if (
            firstArg.isArrowFunctionExpression() ||
            firstArg.isFunctionExpression()
          ) {
            return firstArg;
          }
          // Handle memo(forwardRef(() => {}))
          if (firstArg.isCallExpression()) {
            return resolveComponentFunction(firstArg);
          }
        }
      }
    }

    return null;
  }

  /**
   * Ensures the function has a block body (converts expression arrows).
   * Returns the block body path.
   */
  function ensureBlockBody(fnPath) {
    const body = fnPath.get("body");
    if (!body.isBlockStatement()) {
      // Arrow with expression body: () => <div />
      // Convert to: () => { return <div />; }
      body.replaceWith(t.blockStatement([t.returnStatement(body.node)]));
    }
    return fnPath.get("body");
  }

  // Local aliases we import from React under renamed names so they can't
  // collide with anything a user might define in the same file.
  const USE_EFFECT_ALIAS = "__heap_useEffect";
  const USE_REF_ALIAS = "__heap_useRef";

  /**
   * Builds: window.__heapTracker && window.__heapTracker.<method>(_heap_)
   */
  function buildTrackerMemberCall(method, args = [t.identifier("_heap_")]) {
    return t.expressionStatement(
      t.logicalExpression(
        "&&",
        t.binaryExpression(
          "!==",
          t.unaryExpression("typeof", t.identifier("window"), true),
          t.stringLiteral("undefined")
        ),
        t.logicalExpression(
          "&&",
          t.memberExpression(
            t.identifier("window"),
            t.identifier("__heapTracker")
          ),
          t.callExpression(
            t.memberExpression(
              t.memberExpression(
                t.identifier("window"),
                t.identifier("__heapTracker")
              ),
              t.identifier(method)
            ),
            args
          )
        )
      )
    );
  }

  /**
   * Builds the unmount-detection useEffect:
   *
   *   __heap_useEffect(() => {
   *     window.__heapTracker && window.__heapTracker.markMounted(_heap_);
   *     return () => {
   *       window.__heapTracker && window.__heapTracker.markUnmounted(_heap_);
   *     };
   *   }, []);
   *
   * StrictMode double-invokes effects; the tracker handles that with a mount
   * counter, so we don't need any extra guards here.
   */
  function buildUnmountEffect() {
    const cleanup = t.arrowFunctionExpression(
      [],
      t.blockStatement([buildTrackerMemberCall("markUnmounted")])
    );
    const effectBody = t.arrowFunctionExpression(
      [],
      t.blockStatement([
        buildTrackerMemberCall("markMounted"),
        t.returnStatement(cleanup),
      ])
    );
    return t.expressionStatement(
      t.callExpression(t.identifier(USE_EFFECT_ALIAS), [
        effectBody,
        t.arrayExpression([]),
      ])
    );
  }

  /**
   * Injects a heap marker declaration at the top of the component body,
   * plus the live-tracker registration and (unless opted out) an
   * unmount-detecting useEffect.
   *
   * The marker is stabilized across renders via useRef: it's created once
   * on first render and reused on every subsequent render. Without this,
   * `var _heap_ = new (...)()` would re-run every render and only render-1's
   * marker would receive markMounted/markUnmounted (the effect has `[]` deps),
   * so leaks from later renders' closures would never trigger a live warning.
   *
   * Generates:
   *   var _heap_ref_ = __heap_useRef(null);
   *   if (_heap_ref_.current === null) {
   *     _heap_ref_.current = new (function ComponentName$Heap() {})();
   *     typeof window !== "undefined" && window.__heapTracker
   *       && window.__heapTracker.track(_heap_ref_.current, "ComponentName");
   *   }
   *   var _heap_ = _heap_ref_.current;
   *   __heap_useEffect(() => {
   *     window.__heapTracker && window.__heapTracker.markMounted(_heap_);
   *     return () =>
   *       window.__heapTracker && window.__heapTracker.markUnmounted(_heap_);
   *   }, []);
   *
   * `_heap_` keeps its original identifier so the Phase-2 `_heap_ && 0`
   * injector continues to capture the (now stable) marker into nested
   * closures unchanged.
   *
   * The marker constructor is registered in markerConstructors WeakSet so
   * the FunctionExpression visitor skips it. Closures inside the useEffect
   * get processed by Phase-2 normally — harmless.
   */
  function injectMarkerVariable(bodyPath, componentName, state) {
    const markerName = `${componentName}$Heap`;

    // Build the named function expression node
    const markerFnExpr = t.functionExpression(
      t.identifier(markerName), // named constructor — searchable in heap
      [], // no params
      t.blockStatement([]) // empty body
    );

    // Register the marker constructor so it gets skipped by the FunctionExpression visitor
    markerConstructors.add(markerFnExpr);

    // var _heap_ref_ = __heap_useRef(null);
    const refDeclaration = t.variableDeclaration("var", [
      t.variableDeclarator(
        t.identifier("_heap_ref_"),
        t.callExpression(t.identifier(USE_REF_ALIAS), [t.nullLiteral()])
      ),
    ]);

    // _heap_ref_.current
    const refCurrent = () =>
      t.memberExpression(
        t.identifier("_heap_ref_"),
        t.identifier("current")
      );

    // _heap_ref_.current = new (function ComponentName$Heap() {})();
    const assignMarker = t.expressionStatement(
      t.assignmentExpression(
        "=",
        refCurrent(),
        t.newExpression(markerFnExpr, [])
      )
    );

    // typeof window !== "undefined" && window.__heapTracker
    //   && window.__heapTracker.track(_heap_ref_.current, "ComponentName");
    const trackerCall = buildTrackerMemberCall("track", [
      refCurrent(),
      t.stringLiteral(componentName),
    ]);

    // if (_heap_ref_.current === null) { _heap_ref_.current = new …; track(); }
    const initBlock = t.ifStatement(
      t.binaryExpression("===", refCurrent(), t.nullLiteral()),
      t.blockStatement([assignMarker, trackerCall])
    );

    // var _heap_ = _heap_ref_.current;
    const heapAlias = t.variableDeclaration("var", [
      t.variableDeclarator(t.identifier("_heap_"), refCurrent()),
    ]);

    const statements = [refDeclaration, initBlock, heapAlias];
    // eslint-disable-next-line no-param-reassign
    state.needsHeapUseRefImport = true;

    // Skip the lifecycle effect for components opted out via
    // excludeUnmountTracking (e.g. those managed by <Activity mode="hidden">,
    // whose cleanup fires while the fiber is still alive — would cause false
    // positives). The marker + track() still happen, so the component remains
    // searchable in heap snapshots.
    if (!isExcludedFromUnmountTracking(componentName)) {
      statements.push(buildUnmountEffect());
      // eslint-disable-next-line no-param-reassign
      state.needsHeapUseEffectImport = true;
    }

    // Prepend at the top of the component body
    bodyPath.unshiftContainer("body", statements);
  }

  /**
   * Injects `_heap_ && 0` at the top of a nested closure's body.
   * Handles both block-body and expression-body arrows.
   *
   * We use `_heap_ && 0` instead of `void _heap_` because Vite's esbuild
   * pass strips `void expr` as dead code, removing the closure capture.
   * `_heap_ && 0` is a no-op at runtime but esbuild preserves it.
   */
  function injectVoidHeap(fnPath) {
    const captureExpr = t.expressionStatement(
      t.logicalExpression("&&", t.identifier("_heap_"), t.numericLiteral(0))
    );

    if (fnPath.isArrowFunctionExpression()) {
      const body = fnPath.get("body");
      if (body.isBlockStatement()) {
        body.unshiftContainer("body", captureExpr);
      } else {
        // Expression body: () => expr  →  () => { _heap_ && 0; return expr; }
        body.replaceWith(
          t.blockStatement([captureExpr, t.returnStatement(body.node)])
        );
      }
    } else {
      // FunctionExpression or FunctionDeclaration — always block body
      fnPath.get("body").unshiftContainer("body", captureExpr);
    }
  }

  /**
   * Checks if this function path is nested inside a component that has _heap_.
   * Uses findParent to walk up the AST — this is independent of Babel's scope
   * system, which may not reflect dynamically injected bindings.
   *
   * Returns true if an ancestor function is in the componentFunctions WeakSet.
   */
  function shouldInjectVoidHeap(fnPath) {
    // Don't inject into instrumented functions (components/hooks) themselves
    if (instrumentedFunctions.has(fnPath.node)) return false;
    // Don't inject into marker constructors
    if (markerConstructors.has(fnPath.node)) return false;

    // Walk up the AST to find a parent component or hook function
    const parentInstrumented = fnPath.findParent(
      (p) =>
        (p.isFunctionDeclaration() ||
          p.isArrowFunctionExpression() ||
          p.isFunctionExpression() ||
          p.isObjectMethod() ||
          p.isClassMethod()) &&
        instrumentedFunctions.has(p.node)
    );

    return parentInstrumented !== null;
  }

  return {
    name: "babel-plugin-heap-markers",
    visitor: {
      // ─── Phase 0: Per-file setup and (on exit) import management ───
      Program: {
        enter(programPath, state) {
          /* eslint-disable no-param-reassign */
          state.fileImportsReact = programPath.node.body.some(
            (node) =>
              t.isImportDeclaration(node) &&
              node.source.value === "react" &&
              node.importKind !== "type"
          );
          state.needsHeapUseEffectImport = false;
          state.needsHeapUseRefImport = false;

          // When skipServerComponents is on, instrument only files that have
          // a top-level "use client" directive. Server components can't call
          // useEffect; injecting it would crash at module-load time.
          if (skipServerComponents) {
            const directives = programPath.node.directives || [];
            const hasUseClient = directives.some(
              (d) => d.value && d.value.value === "use client"
            );
            state.skipFile = !hasUseClient;
          } else {
            state.skipFile = false;
          }
          /* eslint-enable no-param-reassign */
        },
        exit(programPath, state) {
          const emitsConfig =
            logging === false ||
            leakAgeMs !== 10000 ||
            suspectThreshold !== 1 ||
            sweepIntervalMs !== 2000 ||
            warnCooldownMs !== 30000;

          if (emitsConfig && !state.skipFile) {
            const configAst = t.ifStatement(
              t.binaryExpression(
                "!==",
                t.unaryExpression("typeof", t.identifier("window")),
                t.stringLiteral("undefined")
              ),
              t.blockStatement([
                t.expressionStatement(
                  t.assignmentExpression(
                    "=",
                    t.memberExpression(t.identifier("window"), t.identifier("__heapTrackerOptions")),
                    t.objectExpression([
                      t.objectProperty(t.identifier("logging"), t.booleanLiteral(logging)),
                      t.objectProperty(t.identifier("leakAgeMs"), t.numericLiteral(leakAgeMs)),
                      t.objectProperty(t.identifier("suspectThreshold"), t.numericLiteral(suspectThreshold)),
                      t.objectProperty(t.identifier("sweepIntervalMs"), t.numericLiteral(sweepIntervalMs)),
                      t.objectProperty(t.identifier("warnCooldownMs"), t.numericLiteral(warnCooldownMs)),
                    ])
                  )
                ),
                t.expressionStatement(
                  t.logicalExpression(
                    "&&",
                    t.memberExpression(t.identifier("window"), t.identifier("__heapTracker")),
                    t.callExpression(
                      t.memberExpression(
                        t.memberExpression(t.identifier("window"), t.identifier("__heapTracker")),
                        t.identifier("configure")
                      ),
                      [t.memberExpression(t.identifier("window"), t.identifier("__heapTrackerOptions"))]
                    )
                  )
                )
              ])
            );
            programPath.unshiftContainer("body", configAst);
          }

          const specifiers = [];
          if (state.needsHeapUseRefImport) {
            specifiers.push(
              t.importSpecifier(
                t.identifier(USE_REF_ALIAS),
                t.identifier("useRef")
              )
            );
          }
          if (state.needsHeapUseEffectImport) {
            specifiers.push(
              t.importSpecifier(
                t.identifier(USE_EFFECT_ALIAS),
                t.identifier("useEffect")
              )
            );
          }
          if (specifiers.length === 0) return;

          // Try to attach to an existing react import. Skip ones that use a
          // namespace specifier (`import * as React from "react"`) — you can't
          // mix `* as X` with named specifiers in the same declaration.
          // Also skip type-only imports (`import type {...} from "react"`),
          // which Babel's TS transform strips wholesale, taking our added
          // value specifiers with them.
          const reuseTarget = programPath.node.body.find(
            (node) =>
              t.isImportDeclaration(node) &&
              node.source.value === "react" &&
              node.importKind !== "type" &&
              !node.specifiers.some((s) => t.isImportNamespaceSpecifier(s))
          );

          if (reuseTarget) {
            reuseTarget.specifiers.push(...specifiers);
          } else {
            programPath.unshiftContainer(
              "body",
              t.importDeclaration(specifiers, t.stringLiteral("react"))
            );
          }
        },
      },

      // ─── Phase 1: Detect components and inject marker declarations ───

      // Handle: function MyComponent() { ... }
      // Handle: export default function MyComponent() { ... }
      // Handle: function useMyHook() { ... }
      FunctionDeclaration(fnPath, state) {
        if (state.skipFile) return;
        // The injected marker uses useRef + useEffect, so files that don't
        // import React can't be instrumented. Also filters out `use*`-named
        // utilities in non-React files that aren't actually hooks.
        if (!state.fileImportsReact) return;
        const name = fnPath.node.id?.name;
        if (!name) return;
        if (isExcludedName(name)) return;

        // Custom hooks: any .ts/.tsx/.js/.jsx file, use* prefix
        if (trackHooks && isCustomHook(name) && isJSOrTSFile(state.filename)) {
          instrumentedFunctions.add(fnPath.node);
          injectMarkerVariable(fnPath.get("body"), name, state);
          return;
        }

        // Components: .tsx/.jsx only, PascalCase, must contain JSX
        if (!isReactFile(state.filename)) return;
        if (!isPascalCase(name)) return;
        if (!containsJSX(fnPath)) return;

        instrumentedFunctions.add(fnPath.node);
        injectMarkerVariable(fnPath.get("body"), name, state);
      },

      // Handle: const MyComponent = () => { ... }
      // Handle: const MyComponent = memo(() => { ... })
      // Handle: const MyComponent = forwardRef((props, ref) => { ... })
      // Handle: const useMyHook = () => { ... }
      VariableDeclarator(varPath, state) {
        if (state.skipFile) return;
        if (!state.fileImportsReact) return;
        const name = varPath.node.id?.name;
        if (!name) return;
        if (isExcludedName(name)) return;

        const isHook = isCustomHook(name) && trackHooks;
        const isComponent = isPascalCase(name);
        if (!isHook && !isComponent) return;

        // Hooks can be in any JS/TS file; components only in JSX/TSX
        if (isHook && !isJSOrTSFile(state.filename)) return;
        if (!isHook && !isReactFile(state.filename)) return;

        const init = varPath.get("init");
        // For hooks, the init can be a direct arrow/function (no memo/forwardRef wrapper)
        let fnPath;
        if (isHook) {
          fnPath =
            init.isArrowFunctionExpression() || init.isFunctionExpression()
              ? init
              : null;
        } else {
          fnPath = resolveComponentFunction(init);
        }
        if (!fnPath) return;

        // Only components need JSX check; hooks don't
        if (!isHook && !containsJSX(fnPath)) return;

        instrumentedFunctions.add(fnPath.node);
        const bodyPath = ensureBlockBody(fnPath);
        injectMarkerVariable(bodyPath, name, state);
      },

      // ─── Phase 2: Inject void _heap_ into nested closures ───
      //
      // These visitors run on EVERY arrow/function expression in the file.
      // Babel's depth-first traversal ensures that by the time we visit
      // a nested closure, the parent component's marker has already been
      // injected (because VariableDeclarator/FunctionDeclaration visitors
      // run on the parent node first in the enter phase).

      ArrowFunctionExpression(fnPath, state) {
        if (state.skipFile) return;
        if (!isJSOrTSFile(state.filename)) return;
        if (shouldInjectVoidHeap(fnPath)) {
          injectVoidHeap(fnPath);
        }
      },

      FunctionExpression(fnPath, state) {
        if (state.skipFile) return;
        if (!isJSOrTSFile(state.filename)) return;
        if (shouldInjectVoidHeap(fnPath)) {
          injectVoidHeap(fnPath);
        }
      },

      ObjectMethod(fnPath, state) {
        if (state.skipFile) return;
        if (!isJSOrTSFile(state.filename)) return;
        if (shouldInjectVoidHeap(fnPath)) {
          injectVoidHeap(fnPath);
        }
      },

      ClassMethod(fnPath, state) {
        if (state.skipFile) return;
        if (!isJSOrTSFile(state.filename)) return;
        if (shouldInjectVoidHeap(fnPath)) {
          injectVoidHeap(fnPath);
        }
      },
    },
  };
};
