/**
 * webpack / Turbopack loader behind `react-memory-leak-detector/next`.
 *
 * Runs the same heap-markers transform as the Vite plugin (Oxc engine, Babel
 * fallback — see ./engine) as a *pre* step on the original JSX/TS source, and
 * re-emits it untouched apart from the injected markers. Next's own compiler
 * (SWC, or Babel if the app has a config) compiles the result as usual, so the
 * app keeps SWC-only features such as `next/font`.
 *
 * `../next.js` only registers this loader for the development *browser*
 * compilation, using public settings only: webpack's `isServer` flag from
 * Next's `webpack()` hook, and Turbopack's `browser` rule condition (Next 16+).
 * Server Components are never compiled for the browser, so they are never
 * instrumented (they can't call the injected useRef/useEffect). On Next 15's
 * Turbopack, which can't target the browser, only "use client" files are
 * instrumented (`skipServerComponents`). The loader itself needs no knowledge
 * of Next's internal module layers.
 */
const { createEngine } = require("./engine");
const { reviveOptions } = require("./next-options");

// One engine per distinct option set, per loader process (Turbopack runs
// loaders in a pool of Node workers; webpack runs them in-process).
const engines = new Map();
function getEngine(options) {
  const key = JSON.stringify(options);
  let engine = engines.get(key);
  if (!engine) {
    engine = createEngine(reviveOptions(options));
    engines.set(key, engine);
  }
  return engine;
}

module.exports = function heapMarkersNextLoader(source, inputMap) {
  const callback = this.async();
  const options = (this.getOptions ? this.getOptions() : this.query) || {};

  // Dev-only. ../next.js only registers this loader for development where the
  // bundler can express that, but Next 15's Turbopack can't, so check here too.
  if (process.env.NODE_ENV === "production") {
    callback(null, source, inputMap);
    return;
  }

  const code = typeof source === "string" ? source : String(source);
  // The engines expect POSIX-style ids (as Vite provides), e.g. for their
  // node_modules guard; normalize Windows paths.
  const id = this.resourcePath.replace(/\\/g, "/");
  getEngine(options)
    .transform(code, id)
    .then((result) => {
      if (!result) {
        callback(null, source, inputMap);
        return;
      }
      let map = null;
      if (result.map) {
        // magic-string returns a SourceMap instance; Babel a plain object.
        // Normalize to plain JSON and embed the original source so devtools
        // can show it even though this is the first loader in the chain.
        map = JSON.parse(JSON.stringify(result.map));
        if (!map.sourcesContent) map.sourcesContent = [code];
      }
      callback(null, result.code, map);
    })
    .catch((err) => callback(err));
};
