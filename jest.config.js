const path = require("path");

// One config, two projects, run by a single `npm test`:
//
//   • unit — the fast, deterministic suites (ts-jest).
//   • gc   — the real-GC end-to-end leak suite (__tests__/*.gc.ts), transformed
//            with babel-jest so the REAL babel plugin instruments the fixtures.
//
// The gc project needs a real gc(). Rather than the --expose-gc CLI flag (which
// would expose window.gc process-wide and break the unit suites that assert it's
// absent), __tests__/gc-setup.ts exposes gc() per-worker via v8.setFlagsFromString.
// So a plain `jest` invocation works — no --expose-gc and no --runInBand needed.

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: "unit",
      testEnvironment: "jsdom",
      testMatch: ["**/__tests__/**/*.test.(js|ts|tsx)"],
      transform: {
        "^.+\\.tsx?$": [
          "ts-jest",
          {
            tsconfig: {
              module: "commonjs",
              target: "es2021",
              esModuleInterop: true,
              strict: true,
              skipLibCheck: true,
              types: ["jest", "node"],
            },
          },
        ],
      },
    },
    {
      displayName: "gc",
      testEnvironment: "jsdom",
      testMatch: ["**/__tests__/**/*.gc.ts"],
      // Sets window.__heapTrackerOptions before the runtime loads, so its
      // one-time "tracker installed" console.info is suppressed for the suite.
      setupFiles: [path.resolve(__dirname, "__tests__/gc-setup.ts")],
      transform: {
        "^.+\\.[jt]sx?$": [
          "babel-jest",
          {
            babelrc: false,
            configFile: false,
            presets: [
              ["@babel/preset-env", { targets: { node: "current" } }],
              // classic runtime + the fixtures' `import React` keep the plugin's
              // `fileImportsReact` guard satisfied.
              ["@babel/preset-react", { runtime: "classic" }],
              "@babel/preset-typescript",
            ],
            // Plugins run before presets, so the heap plugin sees the JSX and
            // the `react` import before preset-react/preset-env rewrite them.
            plugins: [[path.resolve(__dirname, "babel-plugin.js"), {}]],
          },
        ],
      },
    },
  ],
};
