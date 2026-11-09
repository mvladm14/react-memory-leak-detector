// Compiles a fixture at test time, for gc suites that need a pipeline other
// than the gc project's fixed babel-jest config (heap plugin, default options):
// plugin options such as `excludeUnmountTracking`, an engine pre-pass the way
// the Vite plugin / Next.js wrapper run it, or the React Compiler.
//
// The result is evaluated as CommonJS with this module's `require`, so it
// shares the test's React instance (and @testing-library's renderer).

import fs from "fs";
import path from "path";
import React from "react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const babel = require("@babel/core") as typeof import("@babel/core");

export type CompileOptions = {
  /** Heap-marker options (the Babel plugin's / engines' options). */
  pluginOptions?: Record<string, unknown>;
  /**
   * "oxc" | "babel": run that engine first, as its own pass (Vite / Next.js
   * order). Omitted: run the Babel plugin in the same pass as the presets.
   */
  engine?: "oxc" | "babel";
  /** Also run babel-plugin-react-compiler, targeting the installed React. */
  reactCompiler?: boolean;
};

export type CompiledFixture = {
  code: string;
  exports: Record<string, any>;
  /** Problems the React Compiler logged (bail-outs, errors); [] if none. */
  compilerProblems: string[];
};

export async function compileFixture(
  fixture: string,
  { pluginOptions = {}, engine, reactCompiler = false }: CompileOptions = {},
): Promise<CompiledFixture> {
  const filename = path.join(__dirname, "fixtures", fixture);
  let code = fs.readFileSync(filename, "utf8");
  const plugins: any[] = [];

  if (engine) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createEngine } = require("../lib/engine");
    const result = await createEngine({ engine, silent: true, ...pluginOptions }).transform(
      code,
      filename,
    );
    if (result) code = result.code;
  } else {
    plugins.push([path.resolve(__dirname, "../babel-plugin.js"), pluginOptions]);
  }

  const compilerProblems: string[] = [];
  if (reactCompiler) {
    plugins.push([
      "babel-plugin-react-compiler",
      {
        // React 17/18 need the react-compiler-runtime package; 19 ships it.
        target: React.version.split(".")[0],
        panicThreshold: "none",
        logger: {
          logEvent(_file: string, event: any) {
            if (event.kind !== "CompileSuccess") {
              const d = (event.detail && (event.detail.options || event.detail)) || {};
              compilerProblems.push(`${event.kind}: ${d.reason || ""}`);
            }
          },
        },
      },
    ]);
  }

  const out = babel.transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [
      ["@babel/preset-env", { targets: { node: "current" }, modules: "commonjs" }],
      ["@babel/preset-react", { runtime: "classic" }],
      "@babel/preset-typescript",
    ],
    plugins,
  })!.code!;

  const mod = { exports: {} as Record<string, any> };
  // eslint-disable-next-line no-new-func
  new Function("require", "module", "exports", out)(require, mod, mod.exports);
  return { code: out, exports: mod.exports, compilerProblems };
}
