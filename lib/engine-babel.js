/**
 * Babel engine for react-memory-leak-detector's bundler integrations: the Vite
 * plugin (`../vite.js`) and the Next.js loader (`./next-loader.js`).
 *
 * This is the original transform: it runs the heap-markers Babel plugin
 * (`../babel-plugin`) standalone as a pre-transform step (Vite's
 * `enforce: "pre"` hook; a webpack/Turbopack pre-loader in Next.js). It's
 * transformer-agnostic — independent of what compiles the code afterward
 * (@vitejs/plugin-react v5 or v6+, SWC, Next's own compiler, or nothing) —
 * because it only injects markers and re-emits JSX/TS untouched.
 *
 * Cost vs. the Oxc engine: it pulls in `@babel/core`, parses every react file
 * with Babel (a second parse on top of the app's own transformer), reprints
 * instrumented files, and needs `parserPlugins` opt-ins for non-default syntax.
 * The dispatcher in `./engine.js` selects between this and the Oxc engine.
 *
 * Requires `@babel/core`.
 */
const babelPluginHeapMarkers = require("../babel-plugin");

// `error.code` of the failure thrown when @babel/core can't be loaded, so the
// auto-detect dispatcher (./engine.js) can explain that NEITHER engine works.
const BABEL_UNAVAILABLE = "ERR_HEAP_BABEL_UNAVAILABLE";

let babelRef;
function getBabel() {
  if (!babelRef) {
    try {
      babelRef = require("@babel/core");
    } catch (err) {
      const error = new Error(
        '[react-memory-leak-detector] "@babel/core" is required when using the "babel" engine. ' +
          'Please install "@babel/core" as a dependency or devDependency in your project.'
      );
      error.code = BABEL_UNAVAILABLE;
      throw error;
    }
  }
  return babelRef;
}

/**
 * Whether `@babel/core` can be loaded. `@babel/core` is an optional peer
 * dependency (Next.js, for one, bundles a private copy that other packages
 * can't use), so the auto-detect dispatcher in ./engine.js checks this before
 * falling back to this engine.
 */
function isAvailable() {
  try {
    getBabel();
    return true;
  } catch {
    return false;
  }
}

// @babel/parser plugins needed to PARSE (not transform) a given file. We only
// parse — the marker transform re-emits JSX/TS untouched for the React plugin.
function parserPluginsFor(file) {
  const dot = file.lastIndexOf(".");
  const raw = dot === -1 ? "" : file.slice(dot + 1); // "tsx", "mts", "cjs", …
  const ext = raw.replace(/^[cm]/, ""); // .mts→ts, .cjs→js, .mjs→js
  const plugins = [];
  if (ext === "ts" || ext === "tsx") plugins.push("typescript");
  if (ext === "tsx" || ext === "jsx" || ext === "js") plugins.push("jsx");
  return plugins;
}

module.exports = function heapMarkersBabelEngine(options = {}) {
  const {
    include = /\.[cm]?[jt]sx?$/,
    exclude,
    apply = "serve",
    parserPlugins = [],
    ...babelOptions
  } = options;
  // The Babel plugin has its own `include` gate; keep it aligned with ours so a
  // caller that narrows `include` narrows both.
  babelOptions.include = include;

  return {
    name: "react-memory-leak-detector",
    enforce: "pre",
    apply,
    async transform(code, id) {
      // Strip Vite's query suffix (`App.tsx?v=abc`) before matching.
      const file = id.split("?", 1)[0];
      // Skip virtual modules, dependencies, and anything outside include/exclude.
      if (id.includes("\0") || file.includes("/node_modules/")) return null;
      if (!include.test(file)) return null;
      if (exclude && exclude.test(file)) return null;
      // Component/hook detection requires a `react` import, so a file that never
      // mentions "react" can't be instrumented — a cheap gate before Babel runs.
      if (!code.includes("react")) return null;

      const result = await getBabel().transformAsync(code, {
        filename: file,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        // Parse (not transform) JSX/TS so we re-emit the source unchanged apart
        // from the injected markers; the React plugin transforms it afterwards.
        parserOpts: { plugins: [...parserPluginsFor(file), ...parserPlugins] },
        plugins: [[babelPluginHeapMarkers, babelOptions]],
      });

      // The Babel plugin sets `metadata.heapMarkers` only when it actually
      // instruments a file. Skip re-emitting (and generating a sourcemap for)
      // files it left untouched — Babel re-prints every file it parses, so
      // without this every react-importing module would be needlessly
      // round-tripped on top of the React plugin's own transform.
      if (
        !result ||
        result.code == null ||
        !(result.metadata && result.metadata.heapMarkers)
      ) {
        return null;
      }
      return { code: result.code, map: result.map };
    },
  };
};

module.exports.isAvailable = isAvailable;
module.exports.BABEL_UNAVAILABLE = BABEL_UNAVAILABLE;
