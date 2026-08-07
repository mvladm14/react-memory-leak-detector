/**
 * Vite plugin: react-memory-leak-detector
 *
 * First-class Vite integration. Rather than wiring the Babel plugin through
 * `@vitejs/plugin-react`'s `babel` option (which v6+ removed when it switched
 * to Oxc), this runs the heap-markers transform itself in an `enforce: "pre"`
 * `transform` hook. That makes it independent of the React plugin's
 * transformer, so it works with:
 *
 *   - @vitejs/plugin-react v5 (Babel)
 *   - @vitejs/plugin-react v6+ (Oxc — dropped the `babel` option)
 *   - @vitejs/plugin-react-swc
 *   - no React plugin at all
 *
 * Two engines produce identical markers:
 *   - "oxc"   — parses with `oxc-parser` and splices with `magic-string`. No
 *               `@babel/core`, no reprint, native TS/JSX/decorator parsing.
 *   - "babel" — runs the heap-markers Babel plugin via `@babel/core`. Needs
 *               `parserPlugins` opt-ins for non-default syntax.
 *
 * Pass `engine: "oxc" | "babel"` to force one. When omitted, the plugin
 * auto-detects: it prefers the Oxc engine and falls back to Babel if
 * `oxc-parser` can't be loaded — checked at transform time, so an Oxc that is
 * missing or unusable on the current Node/platform degrades to Babel (with a
 * warning) instead of crashing. Both engines run at `enforce: "pre"`, seeing the
 * original JSX/TS source and re-emitting it untouched apart from the injected
 * markers — the React plugin does its normal transform afterward.
 *
 * Usage (dev-only by default — `apply: "serve"`, so markers are stripped from
 * production builds automatically):
 *
 *   import { defineConfig } from "vite";
 *   import react from "@vitejs/plugin-react";
 *   import heapMarkers from "react-memory-leak-detector/vite";
 *
 *   export default defineConfig({
 *     plugins: [heapMarkers({ leakAgeMs: 5000 }), react()],
 *   });
 *
 * Put heapMarkers() BEFORE react(): both run at `enforce: "pre"`, so Vite runs
 * them in array order, and @vitejs/plugin-react v5 compiles JSX in its own
 * transform — if it runs first, markers never see the JSX. A `configResolved`
 * check warns if the order is wrong.
 *
 * Options are the same as ./babel-plugin (leakAgeMs, excludeNames, trackHooks,
 * …) plus:
 *   engine        — "oxc" | "babel". Default: auto-detect (prefer Oxc).
 *   include       — RegExp of files to transform.   Default: /\.[cm]?[jt]sx?$/
 *   exclude       — RegExp of files to skip.         Default: none
 *   apply         — Vite `apply` ("serve"|"build"|fn). Default: "serve" (dev).
 *   silent        — Suppress the one-line "using <engine> engine" banner.
 *                   Default: false.
 *   parserPlugins — Extra @babel/parser plugins (Babel engine only; the Oxc
 *                   engine parses TS/JSX/decorators natively and ignores it).
 */

let announced = false;

function banner(name, silent) {
  if (announced || silent) return;
  announced = true;
  // One line so users know which engine actually ran.
  // eslint-disable-next-line no-console
  console.log(`[react-memory-leak-detector] using "${name}" engine`);
}

// React transform plugins that may compile JSX away before our markers run.
const REACT_PLUGIN_NAMES = new Set([
  "vite:react-babel",
  "vite:react-swc",
  "vite:react-oxc",
]);

/**
 * Builds a `configResolved` hook that warns if a React plugin which compiles
 * JSX in its own `transform` hook is ordered *before* this plugin.
 *
 * We and the React plugin both run at `enforce: "pre"`, so within that phase
 * Vite runs plugins in array order. If `@vitejs/plugin-react` v5's
 * `vite:react-babel` (which compiles JSX in a `transform` hook) comes first, it
 * strips the JSX before our markers are injected, `containsJSX` fails, and
 * components are silently left uninstrumented. v6+ compiles JSX via Vite core
 * (its `vite:react-babel` has no `transform` hook), so ordering is harmless
 * there — we detect the difference by the presence of a `transform` hook and
 * stay quiet on v6.
 */
function makeOrderingGuard(pluginName, silent) {
  let warned = false;
  return function configResolved(config) {
    if (warned || silent) return;
    const plugins = (config && config.plugins) || [];
    const selfIndex = plugins.findIndex((p) => p && p.name === pluginName);
    if (selfIndex === -1) return;
    const offender = plugins.find(
      (p, i) =>
        i < selfIndex &&
        p &&
        REACT_PLUGIN_NAMES.has(p.name) &&
        p.transform,
    );
    if (!offender) return;
    warned = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[react-memory-leak-detector] "${offender.name}" is configured before ` +
        `this plugin and compiles JSX in its own transform, so components will ` +
        `be left uninstrumented. Move heapMarkers() before react() in your ` +
        `Vite plugins array.`,
    );
  };
}

/** Attaches the plugin-ordering guard to a built plugin object. */
function withOrderingGuard(plugin, silent) {
  return { ...plugin, configResolved: makeOrderingGuard(plugin.name, silent) };
}

/**
 * Resolves which engine to use. An explicit `engine` option wins; otherwise
 * prefer Oxc. Note this only checks that `oxc-parser` can be *resolved*; whether
 * it can actually be *loaded* (native binding present, Node new enough) is
 * discovered at transform time — see the auto-detect fallback below.
 */
function resolveEngine(engine) {
  if (engine === "oxc" || engine === "babel") return engine;
  try {
    require.resolve("oxc-parser");
    return "oxc";
  } catch {
    return "babel";
  }
}

module.exports = function heapMarkersVite(options = {}) {
  const { engine, silent = false, ...rest } = options;
  const explicit = engine === "oxc" || engine === "babel";
  const chosen = resolveEngine(engine);

  const makeBabel = () => require("./lib/engine-babel")(rest);

  if (chosen === "babel") {
    banner("babel", silent);
    return withOrderingGuard(makeBabel(), silent);
  }

  const engineOxc = require("./lib/engine-oxc");
  const oxc = engineOxc(rest);

  // An explicit `engine: "oxc"` respects the caller's choice: surface load
  // errors directly rather than silently switching engines.
  if (explicit) {
    banner("oxc", silent);
    return withOrderingGuard(oxc, silent);
  }

  // Auto-detected Oxc. The docs promise a fall back to Babel if `oxc-parser`
  // can't be *loaded* (unsupported Node, missing native binding) — not just if
  // it can't be resolved. So wrap the transform: keep trying Oxc until a
  // dependency-load failure, then switch permanently to Babel for this plugin
  // instance. The banner is emitted only once we know which engine truly ran.
  let usingBabel = false;
  let babelFallback = null;
  const getBabel = () => (babelFallback = babelFallback || makeBabel());

  return withOrderingGuard({
    name: oxc.name,
    enforce: oxc.enforce,
    apply: oxc.apply,
    async transform(code, id) {
      if (usingBabel) return getBabel().transform.call(this, code, id);
      try {
        const result = await oxc.transform.call(this, code, id);
        // A non-null result proves the deps loaded and Oxc handled the file.
        if (result != null) banner("oxc", silent);
        return result;
      } catch (err) {
        if (!err || err.code !== engineOxc.OXC_UNAVAILABLE) throw err;
        usingBabel = true;
        if (!silent) {
          // eslint-disable-next-line no-console
          console.warn(
            `[react-memory-leak-detector] "oxc" engine unavailable, ` +
              `falling back to "babel". ${err.message}`,
          );
        }
        banner("babel", silent);
        return getBabel().transform.call(this, code, id);
      }
    },
  }, silent);
};

module.exports.default = module.exports;
