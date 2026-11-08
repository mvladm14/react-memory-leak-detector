// Type declarations for the CommonJS Next.js integration in `next.js`.
//
// Like `babel-plugin.d.ts`, this uses `export =` because the runtime is
// `module.exports = fn`. It is dependency-free (no `next` import): the config
// type is generic, so your own `NextConfig` flows through unchanged.

import type { HeapMarkersOptions } from "./babel-plugin";

/**
 * Wraps a Next.js config so every React component/hook compiled for the
 * browser in development gets a heap marker + unmount-tracking effect. Works
 * with SWC or Babel, webpack (any Next) and Turbopack (Next 16+; on Next
 * 15.3–15.x only `"use client"` files are instrumented; earlier versions are
 * not supported under Turbopack). Server Components and production builds are
 * left untouched.
 *
 *   import withHeapMarkers from "react-memory-leak-detector/next";
 *   export default withHeapMarkers(nextConfig, { leakAgeMs: 5000 });
 */
// The function form comes first: a function is also an `object`, so the object
// overload would otherwise swallow it.
declare function withHeapMarkers<A extends unknown[], C extends object>(
  nextConfig: (...args: A) => C | Promise<C>,
  options?: withHeapMarkers.HeapMarkersNextOptions,
): (...args: A) => Promise<C>;
declare function withHeapMarkers<C extends object>(
  nextConfig?: C,
  options?: withHeapMarkers.HeapMarkersNextOptions,
): C;

declare namespace withHeapMarkers {
  export interface HeapMarkersNextOptions extends HeapMarkersOptions {
    /**
     * Which marker engine to use: `"oxc"` (oxc-parser, no Babel) or `"babel"`
     * (`@babel/core`). When omitted, prefers `"oxc"` and falls back to
     * `"babel"` if `oxc-parser` can't be loaded.
     * @default auto-detect (prefer "oxc")
     */
    engine?: "oxc" | "babel";
    /** RegExp of files to skip, tested after `include`. Default: none. */
    exclude?: RegExp;
    /**
     * Suppress the one-line `using "<engine>" engine` banner and setup warnings.
     * @default false
     */
    silent?: boolean;
    /**
     * Extra `@babel/parser` plugins (e.g. `["decorators-legacy"]`). Babel engine
     * only; the Oxc engine parses TS/JSX/decorators natively.
     * @default []
     */
    parserPlugins?: Array<string | [string, Record<string, unknown>]>;
  }

  export const withHeapMarkers: typeof import("./next");
  export type { HeapMarkersOptions };
}

export = withHeapMarkers;
