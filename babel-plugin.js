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
 *    Closures in the component's/hook's OWN parameter list (default values
 *    such as `{ onSelect = () => {} }`) are left alone: parameter
 *    expressions get their own environment and can't see the body's
 *    `var _heap_`, so capturing there would throw ReferenceError.
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
const {
  isPascalCase,
  isCustomHook,
  isExcludedName: isExcludedNameShared,
  isReactFile: isReactFileShared,
  isJSOrTSFile: isJSOrTSFileShared,
} = require("./lib/predicates");

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
  // Track closures WE injected (the synthetic unmount effect's arrows). Phase 2
  // must skip them: they already reference _heap_ via markMounted/markUnmounted,
  // and because they're inserted via unshiftContainer during Phase 1 the
  // traversal re-queues them, so leaving them in scope injected `_heap_ && 0`
  // twice. The Oxc engine never sees these nodes (it splices the effect as
  // text), so skipping them keeps the two engines' output at parity.
  const syntheticClosures = new WeakSet();
  // Track closures Phase 2 has ALREADY injected `_heap_ && 0` into, plus the
  // block bodies that now hold the capture. Babel re-queues a subtree whenever
  // another plugin replaces an ancestor node in the same pass — e.g.
  // @babel/preset-react turning `<button onClick={() => ...}>` into a
  // createElement() call — so the same closure node can reach our visitor a
  // second time. Without this guard it would get a second capture statement.
  // Parse-only setups (the Vite engine, the unit tests) never re-visit, which
  // is why the duplicate only showed up in webpack/Next/babel-jest pipelines.
  // The body block is tracked too so a later arrow→function conversion
  // (preset-env with old targets) that reuses the block stays deduplicated.
  const capturedClosures = new WeakSet();
  // The BlockStatements that received a marker, i.e. the blocks that declare
  // `var _heap_`. Phase 2 captures a closure iff it sits lexically inside one
  // of these blocks (and no instrumented function node comes first on the way
  // up). That is exactly where `_heap_` is in scope, so it is the one rule
  // that stays correct whatever other plugins do in the same pass:
  //   • closures in an instrumented function's OWN parameter list (default
  //     values such as `{ onSelect = () => {} }`) are outside the block —
  //     parameter expressions get their own environment and can't see body
  //     vars, so a capture there would throw ReferenceError;
  //   • when @babel/preset-env lowers default params into the body, the
  //     lowered closures land inside this block (capture is safe) — except
  //     in the body-shadows-a-param-name case, where the transform wraps the
  //     original block in an IIFE and puts the lowered defaults outside it:
  //     the block object is reused as the IIFE body, so the rule still holds;
  //   • it doesn't depend on node identity or tags on the closure itself,
  //     which transforms like destructuring (cloneNode), shorthand-properties,
  //     classes and async-to-generator do not preserve.
  const markerBlocks = new WeakSet();

  // Detection predicates are shared with the Oxc engine via ./lib/predicates so
  // the two engines can't drift. The file-gate helpers close over this plugin's
  // `include`/`excludeNames`, keeping their call sites single-argument.
  const isExcludedName = (name) => isExcludedNameShared(name, excludeNames);
  const isReactFile = (filename) => isReactFileShared(filename, include);
  const isJSOrTSFile = (filename) => isJSOrTSFileShared(filename, include);

  function isExcludedFromUnmountTracking(name) {
    return excludeUnmountTracking.some((re) => re.test(name));
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
    // These are our own closures — keep Phase 2 from injecting `_heap_ && 0`
    // into them (they already capture _heap_, and re-queued traversal would
    // otherwise inject it twice). See syntheticClosures above.
    syntheticClosures.add(effectBody);
    syntheticClosures.add(cleanup);
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
    // Signal to wrappers (e.g. the Vite plugin) that this file was actually
    // instrumented, so they can skip re-emitting untouched files.
    // eslint-disable-next-line no-param-reassign
    state.file.metadata.heapMarkers = true;
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
    markerBlocks.add(bodyPath.node);
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

    capturedClosures.add(fnPath.node);

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

    // Record the (possibly freshly synthesized) block so a re-visit via a
    // different function node that still owns this block is also skipped.
    capturedClosures.add(fnPath.node.body);
  }

  /**
   * Decides whether a nested closure should capture `_heap_`: true iff it is
   * lexically inside the block that declares `_heap_` (see markerBlocks).
   */
  function shouldInjectVoidHeap(fnPath) {
    // Don't inject into instrumented functions (components/hooks) themselves
    if (instrumentedFunctions.has(fnPath.node)) return false;
    // Don't inject into marker constructors
    if (markerConstructors.has(fnPath.node)) return false;
    // Don't inject into closures we synthesized (the unmount effect)
    if (syntheticClosures.has(fnPath.node)) return false;
    // Don't inject twice when Babel re-visits a closure after another plugin
    // replaced an ancestor (see capturedClosures above)
    if (capturedClosures.has(fnPath.node)) return false;
    if (capturedClosures.has(fnPath.node.body)) return false;
    // Walk up to the nearest ancestor that is either a block declaring
    // `var _heap_` or an instrumented function node. Reaching the block first
    // means the closure is lexically inside that function's body, where
    // `_heap_` is in scope: capture. Reaching the function node first means
    // the closure sits in its parameter list (default values), where body
    // vars are NOT visible: never capture there (see markerBlocks above).
    // Walking the AST rather than Babel's scope keeps this independent of
    // bindings injected mid-traversal.
    const anchor = fnPath.findParent(
      (p) => markerBlocks.has(p.node) || instrumentedFunctions.has(p.node)
    );
    return anchor !== null && markerBlocks.has(anchor.node);
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
            // Injecting the runtime-config block also counts as instrumenting
            // the file (see injectMarkerVariable).
            // eslint-disable-next-line no-param-reassign
            state.file.metadata.heapMarkers = true;
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
        // Already instrumented on an earlier visit (Babel re-queues subtrees
        // another plugin replaced in the same pass) — never inject twice.
        if (instrumentedFunctions.has(fnPath.node)) return;

        // ─── Phase 1: is this declaration itself a component or hook? ───
        // The injected marker uses useRef + useEffect, so files that don't
        // import React can't be instrumented. Also filters out `use*`-named
        // utilities in non-React files that aren't actually hooks.
        if (state.fileImportsReact) {
          const name = fnPath.node.id?.name;
          if (name && !isExcludedName(name)) {
            // Custom hooks: any .ts/.tsx/.js/.jsx file, use* prefix
            if (
              trackHooks &&
              isCustomHook(name) &&
              isJSOrTSFile(state.filename)
            ) {
              instrumentedFunctions.add(fnPath.node);
              injectMarkerVariable(fnPath.get("body"), name, state);
              return;
            }
            // Components: .tsx/.jsx only, PascalCase, must contain JSX
            if (
              isReactFile(state.filename) &&
              isPascalCase(name) &&
              containsJSX(fnPath)
            ) {
              instrumentedFunctions.add(fnPath.node);
              injectMarkerVariable(fnPath.get("body"), name, state);
              return;
            }
          }
        }

        // ─── Phase 2: a nested function declaration inside an instrumented
        // component/hook. Mirrors the ArrowFunctionExpression /
        // FunctionExpression visitors so `function helper() {}` captures
        // _heap_ too — otherwise a leak whose sole retainer is a nested
        // function declaration would go undetected (and diverge from the Oxc
        // engine, which already instruments these).
        if (!isJSOrTSFile(state.filename)) return;
        if (shouldInjectVoidHeap(fnPath)) {
          injectVoidHeap(fnPath);
        }
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

        // Phase 1 can be re-run on the same node when another plugin replaces
        // an ancestor in the same pass; never inject the marker twice.
        if (instrumentedFunctions.has(fnPath.node)) return;
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
