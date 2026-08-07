/**
 * @jest-environment node
 */
// Runs in the `node` environment (not jsdom): Vite bundles esbuild, which
// throws "Buffer.from('') instanceof Uint8Array is false" under jsdom's patched
// globals. This suite drives Vite's build/transform pipeline and needs no DOM.
//
// End-to-end integration against a REAL Vite instance (not just calling the
// plugin's transform hook directly). Proves two things the unit tests can only
// assert indirectly:
//   1. Markers are injected through Vite's actual dev pipeline (createServer +
//      transformRequest), ahead of the JSX transform.
//   2. `apply: "serve"` really strips markers from a production build.
//
// `vite` is ESM-only, so it's loaded via dynamic import() inside each test
// (works on every supported Node, unlike a top-level require). The engine is
// left at its default: on Node <20.19 (no oxc-parser) it falls back to Babel,
// but either engine injects the same markers, so these tests need no gate.
const path = require("path");
const heapMarkers = require("../vite");

const ROOT = path.resolve(__dirname, "fixtures/vite-app");

describe("react-memory-leak-detector/vite — real Vite integration", () => {
  it("injects markers during dev (createServer + transformRequest)", async () => {
    const { createServer } = await import("vite");
    const server = await createServer({
      configFile: false,
      root: ROOT,
      logLevel: "silent",
      server: { middlewareMode: true, hmr: false },
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [heapMarkers({ silent: true })],
    });
    try {
      const result = await server.transformRequest("/Widget.tsx");
      expect(result).not.toBeNull();
      // Marker injected before Vite's own JSX transform ran.
      expect(result.code).toContain("Widget$Heap");
      // The nested `function handleClick()` declaration was captured (F2).
      expect(result.code).toContain("_heap_ && 0;");
      // Sanity: this really is our component's code.
      expect(result.code).toContain("widget-marker-probe");
    } finally {
      await server.close();
    }
  }, 30000);

  it("does NOT inject markers into a production build (apply: 'serve')", async () => {
    const { build } = await import("vite");
    const output = await build({
      configFile: false,
      root: ROOT,
      logLevel: "silent",
      plugins: [heapMarkers({ silent: true })],
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          input: path.join(ROOT, "Widget.tsx"),
          // Keep the entry's exports so the never-rendered component isn't
          // tree-shaken away — otherwise "component present" is vacuously true.
          preserveEntrySignatures: "strict",
        },
      },
    });
    const outputs = Array.isArray(output) ? output : [output];
    const code = outputs
      .flatMap((o) => o.output)
      .filter((chunk) => chunk.type === "chunk")
      .map((chunk) => chunk.code)
      .join("\n");
    // The component IS in the bundle...
    expect(code).toContain("widget-marker-probe");
    // ...but no markers, because the plugin only applies to the dev server.
    expect(code).not.toContain("$Heap");
  }, 60000);
});
