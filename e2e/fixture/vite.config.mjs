import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import heapMarkers from "react-memory-leak-detector/vite";

// Matrix knobs, set by the orchestrator (e2e/run.mjs) / docker / CI:
//   PLUGIN_REACT = "v5" | "v6"        which @vitejs/plugin-react (npm aliases)
//   HEAP_ENGINE  = "oxc" | "babel"    forced engine ("" / unset = auto-detect)
//   COMPILER     = "1"                run babel-plugin-react-compiler. Only via
//                                     plugin-react v5's `babel` option (v6
//                                     dropped it); our transform runs first.
const require = createRequire(import.meta.url);
const alias = process.env.PLUGIN_REACT === "v5" ? "plugin-react-v5" : "plugin-react-v6";
const reactMod = require(alias);
const react = reactMod.default ?? reactMod;
const engine = process.env.HEAP_ENGINE || undefined;
if (process.env.COMPILER && process.env.PLUGIN_REACT !== "v5") {
  throw new Error("COMPILER=1 needs PLUGIN_REACT=v5 (v6 has no `babel` option)");
}
const reactOptions = process.env.COMPILER
  ? { babel: { plugins: [["babel-plugin-react-compiler", {}]] } }
  : undefined;

// React 17 has no `react-dom/client`, so the entries' `./mount` import goes to
// the legacy-root twin there. Decided by the React actually installed (run.mjs
// swaps it per combo), not by an env var that could disagree with it.
const reactMajor = Number(require("react/package.json").version.split(".")[0]);
const mountAlias =
  reactMajor < 18
    ? [{ find: /^\.\/mount$/, replacement: fileURLToPath(new URL("./src/mount-legacy.tsx", import.meta.url)) }]
    : [];

export default defineConfig({
  plugins: [
    // MUST precede react(): both are enforce:"pre", so with plugin-react v5
    // (which compiles JSX in its own transform) order decides whether markers
    // see the JSX. This is the correct order; the plugin also warns if it isn't.
    heapMarkers({ engine }),
    react(reactOptions),
  ],
  resolve: { alias: mountAlias },
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
});
