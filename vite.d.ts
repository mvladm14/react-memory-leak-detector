// Type declarations for the CommonJS Vite plugin in `vite.js`.
//
// Like `babel-plugin.d.ts`, this uses `export =` because the runtime is
// `module.exports = fn`. Options extend the Babel plugin's options and add the
// Vite-specific `apply`. It reuses the host's installed `vite` types for the
// return value — you only ever use this with Vite.

import type { Plugin } from "vite";
import type { HeapMarkersOptions } from "./babel-plugin";

/**
 * Vite plugin that tags every React component/hook with a heap marker + a
 * synthetic unmount-tracking effect, by running the heap-markers transform
 * (Oxc by default, Babel as a fallback) in an `enforce: "pre"` step. Works with
 * any React transformer (`@vitejs/plugin-react` v5 or v6+, `-swc`, or none).
 *
 * Place it BEFORE `react()` in the plugins array so markers are injected before
 * the JSX is compiled away:
 *
 *   import heapMarkers from "react-memory-leak-detector/vite";
 *   plugins: [heapMarkers({ leakAgeMs: 5000 }), react()]
 */
declare function heapMarkersVite(
  options?: heapMarkersVite.HeapMarkersViteOptions,
): Plugin;

declare namespace heapMarkersVite {
  export interface HeapMarkersViteOptions extends HeapMarkersOptions {
    /**
     * Which marker engine to use.
     * - `"oxc"`   — parse with `oxc-parser`, splice with `magic-string`
     *   (no `@babel/core`, native TS/JSX/decorator parsing).
     * - `"babel"` — run the heap-markers Babel plugin via `@babel/core`.
     *
     * When omitted, the plugin auto-detects: it prefers `"oxc"` and falls back
     * to `"babel"` only if `oxc-parser` can't be loaded.
     * @default auto-detect (prefer "oxc")
     */
    engine?: "oxc" | "babel";
    /**
     * RegExp of files to skip, tested after `include`. Default: none.
     */
    exclude?: RegExp;
    /**
     * Vite `apply` — when the plugin runs. Defaults to `"serve"` (dev server
     * only), so markers are stripped from production builds. Pass `"build"` or
     * a predicate to run during builds too.
     * @default "serve"
     */
    apply?: Plugin["apply"];
    /**
     * Suppress the one-line `using "<engine>" engine` banner logged once at
     * config load.
     * @default false
     */
    silent?: boolean;
    /**
     * Extra `@babel/parser` plugins (e.g. `["decorators-legacy"]`).
     *
     * **Babel engine only.** That engine parses with Babel — not the app's
     * transformer — and reads no project Babel config, so source using
     * non-default syntax (decorators, `using`, import attributes) must opt its
     * parser plugin in here or Babel will fail to parse the file. The Oxc engine
     * parses TS/JSX/decorators natively and ignores this option.
     * @default []
     */
    parserPlugins?: Array<string | [string, Record<string, unknown>]>;
  }

  export type { HeapMarkersOptions };
}

export = heapMarkersVite;
