/**
 * Engine dispatcher shared by the bundler integrations (`../vite.js`,
 * `./next-loader.js`).
 *
 * Returns a transform object — `{ name, enforce, apply, transform(code, id) }`
 * — backed by one of the two marker engines:
 *   - "oxc"   — `./engine-oxc`   (oxc-parser + magic-string, no Babel)
 *   - "babel" — `./engine-babel` (the heap-markers Babel plugin via @babel/core)
 *
 * `transform` resolves to `{ code, map }` for an instrumented file, or `null`
 * when the file was left untouched.
 *
 * An explicit `engine: "oxc" | "babel"` wins. When omitted, Oxc is preferred and
 * Babel is the fallback if `oxc-parser` can't be *resolved* up front or can't
 * be *loaded* at transform time (unsupported Node, missing native binding).
 *
 * The fallback needs `@babel/core`, an optional peer dependency that many apps
 * (Next.js ones in particular) don't have. When neither engine can run, every
 * file that would have been instrumented fails with ONE error that explains
 * both causes and both fixes, instead of a "@babel/core is required" error for
 * an engine the user never chose.
 */

let announced = false;

function banner(name, silent) {
  if (announced || silent) return;
  announced = true;
  // One line so users know which engine actually ran.
  // eslint-disable-next-line no-console
  console.log(`[react-memory-leak-detector] using "${name}" engine`);
}

function isOxcResolvable() {
  try {
    require.resolve("oxc-parser");
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves which engine to use. An explicit `engine` option wins; otherwise
 * prefer Oxc. Note this only checks that `oxc-parser` can be *resolved*; whether
 * it can actually be *loaded* (native binding present, Node new enough) is
 * discovered at transform time — see the auto-detect fallback below.
 */
function resolveEngine(engine, oxcResolvable = isOxcResolvable) {
  if (engine === "oxc" || engine === "babel") return engine;
  return oxcResolvable() ? "oxc" : "babel";
}

const NO_ENGINE = "ERR_HEAP_NO_ENGINE";

// Why Oxc can't be used when `oxc-parser` isn't even installed.
const OXC_NOT_INSTALLED =
  '"oxc-parser" is not installed (it is an optional dependency, which npm ' +
  "skips on unsupported Node versions and platforms)";

/** The error for "auto-detect found no usable engine". */
function noEngineError(oxcReason) {
  const error = new Error(
    `[react-memory-leak-detector] no marker engine is available. The default ` +
      `"oxc" engine can't be used: ${oxcReason}. The "babel" fallback needs ` +
      `"@babel/core", which isn't installed either. Fix one of them: use Node ` +
      `^20.19 or >=22.12 and reinstall dependencies so "oxc-parser" installs ` +
      `and loads, or install "@babel/core" as a devDependency.`,
  );
  error.code = NO_ENGINE;
  return error;
}

/**
 * Wraps an auto-selected Babel engine so a missing @babel/core is reported as
 * "no engine available" (with the Oxc reason) rather than as a requirement of
 * an engine the user never picked. The Babel engine's own gates (node_modules,
 * include/exclude, files that never mention "react") still run first, so files
 * it would skip anyway never error.
 */
function explainMissingBabel(babelEngine, engineBabel, oxcReason) {
  return {
    ...babelEngine,
    async transform(code, id) {
      try {
        return await babelEngine.transform.call(this, code, id);
      } catch (err) {
        if (err && err.code === engineBabel.BABEL_UNAVAILABLE) {
          throw noEngineError(oxcReason);
        }
        throw err;
      }
    },
  };
}

// `internals` is for tests only (simulating an uninstalled oxc-parser).
function createEngine(options = {}, internals = {}) {
  const { engine, silent = false, ...rest } = options;
  const explicit = engine === "oxc" || engine === "babel";
  const chosen = resolveEngine(engine, internals.oxcResolvable);

  const engineBabel = require("./engine-babel");
  const makeBabel = () => engineBabel(rest);

  if (chosen === "babel") {
    // Explicitly requested: its own "@babel/core is required" error is right.
    if (explicit) {
      banner("babel", silent);
      return makeBabel();
    }
    // Auto-selected because oxc-parser isn't installed.
    if (engineBabel.isAvailable()) banner("babel", silent);
    return explainMissingBabel(makeBabel(), engineBabel, OXC_NOT_INSTALLED);
  }

  const engineOxc = require("./engine-oxc");
  const oxc = engineOxc(rest);

  // An explicit `engine: "oxc"` respects the caller's choice: surface load
  // errors directly rather than silently switching engines. Announce it only
  // once it has actually worked, so a load failure isn't preceded by
  // "using oxc".
  if (explicit) {
    return {
      ...oxc,
      async transform(code, id) {
        const result = await oxc.transform.call(this, code, id);
        if (result != null) banner("oxc", silent);
        return result;
      },
    };
  }

  // Auto-detected Oxc. The docs promise a fall back to Babel if `oxc-parser`
  // can't be *loaded* (unsupported Node, missing native binding) — not just if
  // it can't be resolved. So wrap the transform: keep trying Oxc until a
  // dependency-load failure, then switch permanently to Babel for this
  // instance. The banner is emitted only once we know which engine truly ran.
  let usingBabel = false;
  let babelFallback = null;
  let noEngine = null;
  const getBabel = () => (babelFallback = babelFallback || makeBabel());

  return {
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
        const reason = err.reason || err.message;
        // Check BEFORE announcing a fallback that can't work.
        if (noEngine || !engineBabel.isAvailable()) {
          noEngine = noEngine || noEngineError(reason);
          throw noEngine;
        }
        usingBabel = true;
        if (!silent) {
          // eslint-disable-next-line no-console
          console.warn(
            `[react-memory-leak-detector] "oxc" engine unavailable ` +
              `(${reason}); falling back to "babel".`,
          );
        }
        banner("babel", silent);
        return getBabel().transform.call(this, code, id);
      }
    },
  };
}

module.exports = { createEngine, resolveEngine, NO_ENGINE };
