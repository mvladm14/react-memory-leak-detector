/**
 * Next.js integration: react-memory-leak-detector/next
 *
 *   // next.config.mjs
 *   import withHeapMarkers from "react-memory-leak-detector/next";
 *   export default withHeapMarkers(nextConfig, { leakAgeMs: 5000 });
 *
 * Why not the Babel plugin in a `.babelrc`? A `.babelrc` replaces Next's
 * compiler setup: it must re-declare the `next/babel` preset or nothing
 * compiles, and under webpack it turns SWC off entirely, which breaks
 * SWC-only features such as `next/font` (used by the default create-next-app
 * template). This wrapper leaves Next's compiler alone and adds the
 * heap-markers transform as a *pre* loader (same engines as the Vite plugin),
 * so it works with SWC or Babel, webpack or Turbopack.
 *
 * What gets instrumented: only the development *browser* compilation, and only
 * project files (not node_modules).
 *   - Dev only, so nothing ships to production builds.
 *   - Browser only, because that is where the leak tracker runs and because
 *     React Server Components are never compiled for the browser: they can't
 *     call the injected useRef/useEffect, and this keeps them untouched
 *     without a "use client" heuristic. A shared component with no directive is
 *     still instrumented wherever a Client Component imports it.
 *
 * Bundlers:
 *   - webpack    (`next dev` on Next <= 15, `next dev --webpack` on 16+):
 *                 any Next version with the `webpack()` config hook.
 *   - Turbopack  (`next dev` on Next 16+, `--turbopack` on 15):
 *       Next >= 16      browser-only via `turbopack.rules` conditions, as above.
 *       Next 15.3–15.x  Turbopack ignores the `browser` rule condition here (the
 *                       loader would also see Server Components), so only files
 *                       with a top-level "use client" directive are
 *                       instrumented (`skipServerComponents`). Those are safe in
 *                       every context: the RSC graph only sees a client
 *                       reference for them.
 *       older           no `turbopack` config key; a warning explains that
 *                       Turbopack dev runs uninstrumented (webpack works).
 *
 * Options: the Babel plugin's options (leakAgeMs, excludeNames, trackHooks, …)
 * plus `engine`, `exclude`, `silent` and `parserPlugins` (documented in
 * ./next.d.ts).
 */
const path = require("path");
const { serializeOptions } = require("./lib/next-options");

const LOADER = path.join(__dirname, "lib", "next-loader.js");

// Source files the loader may see. The engines re-check `include`/`exclude`
// (and bail quickly on files that never mention "react").
const WEBPACK_TEST = /\.[cm]?[jt]sx?$/;
const NODE_MODULES = /[\\/]node_modules[\\/]/;
const TURBOPACK_GLOB = "*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}";


/** The app's Next.js version as [major, minor], or null if it can't be read. */
function nextVersion() {
  try {
    const pkg = require(
      require.resolve("next/package.json", { paths: [process.cwd()] }),
    );
    const m = /^(\d+)\.(\d+)/.exec(pkg.version);
    return m ? [Number(m[1]), Number(m[2])] : null;
  } catch {
    return null;
  }
}

/**
 * How to hook into Turbopack for a given Next.js version:
 *   "conditions" — Next >= 16: `turbopack.rules` with working browser /
 *                  development / foreign conditions (15.5 accepts them in its
 *                  schema, but still runs the loader for Server Components).
 *   "use-client" — Next 15.3–15.x: top-level `turbopack.rules` without usable
 *                  conditions; instrument "use client" files only.
 *   null         — older: no `turbopack` config key.
 */
function turbopackMode(version) {
  if (!version) return "conditions"; // unknown: assume a current Next
  const [major, minor] = version;
  if (major >= 16) return "conditions";
  if (major === 15 && minor >= 3) return "use-client";
  return null;
}

/** Appends our rule to `rules[glob]`, keeping any rule the app already has. */
function addTurbopackRule(rules, rule) {
  const out = { ...(rules || {}) };
  const existing = out[TURBOPACK_GLOB];
  if (existing === undefined) out[TURBOPACK_GLOB] = rule;
  else out[TURBOPACK_GLOB] = [...[].concat(existing), rule];
  return out;
}

let warnedOldTurbopack = false;

function withHeapMarkers(nextConfig = {}, options = {}) {
  // `next.config` may export a function `(phase, ctx) => config`.
  if (typeof nextConfig === "function") {
    return async (...args) =>
      withHeapMarkers(await nextConfig(...args), options);
  }

  const loaderOptions = serializeOptions(options);
  const loader = { loader: LOADER, options: loaderOptions };
  const config = { ...nextConfig };

  const userWebpack = nextConfig.webpack;
  config.webpack = (webpackConfig, ctx) => {
    const result =
      typeof userWebpack === "function"
        ? userWebpack(webpackConfig, ctx)
        : webpackConfig;
    if (ctx && ctx.dev && !ctx.isServer) {
      result.module = result.module || {};
      result.module.rules = result.module.rules || [];
      result.module.rules.unshift({
        test: WEBPACK_TEST,
        exclude: NODE_MODULES,
        // Before Next's SWC/Babel loader, so the markers see the original JSX.
        enforce: "pre",
        use: [loader],
      });
    }
    return result;
  };

  const mode = turbopackMode(nextVersion());
  if (mode) {
    const rule =
      mode === "conditions"
        ? {
            loaders: [loader],
            condition: {
              all: ["browser", "development", { not: "foreign" }],
            },
          }
        : {
            // No usable conditions: the loader itself skips production
            // builds, and the engines skip node_modules.
            loaders: [
              {
                loader: LOADER,
                options: { ...loaderOptions, skipServerComponents: true },
              },
            ],
          };
    const turbopack = { ...(nextConfig.turbopack || {}) };
    turbopack.rules = addTurbopackRule(turbopack.rules, rule);
    config.turbopack = turbopack;
  } else if (process.env.TURBOPACK && !warnedOldTurbopack && !options.silent) {
    warnedOldTurbopack = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[react-memory-leak-detector] Turbopack needs Next.js >= 15.3 for " +
        "instrumentation; this dev server runs uninstrumented. Use webpack " +
        "(`next dev` without --turbopack) or upgrade Next.js.",
    );
  }

  return config;
}

module.exports = withHeapMarkers;
module.exports.default = withHeapMarkers;
module.exports.withHeapMarkers = withHeapMarkers;
// Exposed for tests.
module.exports.turbopackMode = turbopackMode;
