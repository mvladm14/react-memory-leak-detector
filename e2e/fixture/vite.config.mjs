import { createRequire } from "node:module";
import { defineConfig } from "vite";
import heapMarkers from "react-memory-leak-detector/vite";

// Matrix knobs, set by the orchestrator (e2e/run.mjs) / docker / CI:
//   PLUGIN_REACT = "v5" | "v6"        which @vitejs/plugin-react (npm aliases)
//   HEAP_ENGINE  = "oxc" | "babel"    forced engine ("" / unset = auto-detect)
const require = createRequire(import.meta.url);
const alias = process.env.PLUGIN_REACT === "v5" ? "plugin-react-v5" : "plugin-react-v6";
const reactMod = require(alias);
const react = reactMod.default ?? reactMod;
const engine = process.env.HEAP_ENGINE || undefined;

export default defineConfig({
  plugins: [
    // MUST precede react(): both are enforce:"pre", so with plugin-react v5
    // (which compiles JSX in its own transform) order decides whether markers
    // see the JSX. This is the correct order; the plugin also warns if it isn't.
    heapMarkers({ engine }),
    react(),
  ],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
});
