const heapMarkersVite = require("../vite");
const { oxcAvailable } = require("./oxc-available");

// The default engine is Oxc; where oxc-parser isn't installable (Node < 20.19,
// e.g. the CI Node 18 leg) the plugin falls back to Babel, so tests that assert
// Oxc-specific behavior at default options are gated to skip there.
const itOxc = oxcAvailable ? it : it.skip;

// The Vite `transform` hook never references `this`, so we can call it plainly
// without binding a Rollup plugin context.
function transform(plugin, code, id) {
  return plugin.transform(code, id);
}

const COMPONENT = `
  import React from "react";
  function MyComponent() {
    const handleClick = () => {
      console.log("clicked");
    };
    return <div onClick={handleClick}>Hello</div>;
  }
`;

describe("react-memory-leak-detector/vite", () => {
  it("exposes a pre-enforced, serve-only Vite plugin", () => {
    const plugin = heapMarkersVite();
    expect(plugin.name).toBe("react-memory-leak-detector");
    expect(plugin.enforce).toBe("pre");
    expect(plugin.apply).toBe("serve"); // dev-only by default
    expect(typeof plugin.transform).toBe("function");
  });

  it("also exposes a `default` (ESM interop)", () => {
    expect(heapMarkersVite.default).toBe(heapMarkersVite);
  });

  it("injects heap markers into a .tsx component", async () => {
    const plugin = heapMarkersVite();
    const result = await transform(plugin, COMPONENT, "/app/src/MyComponent.tsx");
    expect(result).not.toBeNull();
    expect(result.code).toContain("function MyComponent$Heap()");
    expect(result.code).toContain("var _heap_ = _heap_ref_.current;");
    expect(result.code).toContain(
      'window.__heapTracker.track(_heap_ref_.current, "MyComponent")',
    );
    // nested closure capture
    expect(result.code).toContain("_heap_ && 0;");
    expect(result.code).toContain('console.log("clicked");');
  });

  it("preserves JSX and TS (does not transform them — the React plugin does)", async () => {
    const plugin = heapMarkersVite();
    const tsx = `
      import React from "react";
      const Card = (props: { title: string }) => {
        return <div className="card">{props.title}</div>;
      };
    `;
    const result = await transform(plugin, tsx, "/app/src/Card.tsx");
    // JSX left intact (no _jsx/_jsxDEV runtime calls emitted here)
    expect(result.code).toContain('<div className="card">');
    expect(result.code).not.toMatch(/_?jsxDEV|_?jsxs?\(/);
    // TS type annotation preserved for the downstream transformer
    expect(result.code).toContain("title: string");
    expect(result.code).toContain("Card$Heap");
  });

  it("returns a sourcemap", async () => {
    const plugin = heapMarkersVite();
    const result = await transform(plugin, COMPONENT, "/app/src/MyComponent.tsx");
    expect(result.map).toBeTruthy();
    expect(result.map.mappings).toEqual(expect.any(String));
  });

  it("skips node_modules, non-JS/TS files, and files without react", async () => {
    const plugin = heapMarkersVite();
    expect(
      await transform(plugin, COMPONENT, "/app/node_modules/pkg/index.tsx"),
    ).toBeNull();
    expect(
      await transform(plugin, "body { color: red; }", "/app/src/styles.css"),
    ).toBeNull();
    expect(
      await transform(plugin, "export const x = 1;", "/app/src/util.ts"),
    ).toBeNull();
  });

  it("returns null for react files it doesn't actually instrument", async () => {
    const plugin = heapMarkersVite();
    // Imports react but has no component/hook to mark — Babel would re-print it,
    // so the plugin must short-circuit rather than emit an untouched round-trip.
    const noComponents = `
      import { createContext } from "react";
      export const Ctx = createContext(null);
    `;
    expect(
      await transform(plugin, noComponents, "/app/src/context.tsx"),
    ).toBeNull();
  });

  it("honors a custom `exclude`", async () => {
    const plugin = heapMarkersVite({ exclude: /MyComponent/ });
    expect(
      await transform(plugin, COMPONENT, "/app/src/MyComponent.tsx"),
    ).toBeNull();
  });

  itOxc("parses decorators natively (default Oxc engine — no parserPlugins needed)", async () => {
    const decorated = `
      import React from "react";
      function deco(target) { return target; }
      @deco
      class Thing {}
      function MyComp() {
        return <div />;
      }
    `;
    // The default engine is Oxc, which parses TS/JSX/decorators natively, so no
    // `parserPlugins` opt-in is required (unlike the Babel engine).
    const result = await transform(heapMarkersVite(), decorated, "/app/src/Thing.tsx");
    expect(result).not.toBeNull();
    expect(result.code).toContain("MyComp$Heap");
  });

  it("strips Vite's query suffix before matching", async () => {
    const plugin = heapMarkersVite();
    const result = await transform(
      plugin,
      COMPONENT,
      "/app/src/MyComponent.tsx?v=abc123",
    );
    expect(result).not.toBeNull();
    expect(result.code).toContain("MyComponent$Heap");
  });

  it("forwards options to the babel plugin (runtime config injection)", async () => {
    const plugin = heapMarkersVite({ leakAgeMs: 5000 });
    const result = await transform(plugin, COMPONENT, "/app/src/MyComponent.tsx");
    // Non-default options are forwarded to the runtime via __heapTrackerOptions.
    expect(result.code).toContain("__heapTrackerOptions");
    expect(result.code).toContain("leakAgeMs: 5000");
  });

  it("honors a custom `apply`", () => {
    expect(heapMarkersVite({ apply: "build" }).apply).toBe("build");
  });

  describe("plugin-ordering guard (configResolved)", () => {
    // @vitejs/plugin-react v5's `vite:react-babel` compiles JSX in its own
    // transform hook; v6's does it via Vite core and has no transform hook.
    const reactV5 = { name: "vite:react-babel", transform: { handler() {} } };
    const reactV6 = { name: "vite:react-babel" };

    function warnedFor(plugins) {
      const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const self = plugins.find((p) => p.name === "react-memory-leak-detector");
      self.configResolved({ plugins });
      const calls = spy.mock.calls.length;
      spy.mockRestore();
      return calls > 0;
    }

    it("warns when a JSX-compiling React plugin (v5) is ordered before it", () => {
      const self = heapMarkersVite();
      expect(warnedFor([reactV5, self])).toBe(true);
    });

    it("stays quiet when ordered before the React plugin (correct order)", () => {
      const self = heapMarkersVite();
      expect(warnedFor([self, reactV5])).toBe(false);
    });

    it("stays quiet on v6 (no transform hook — ordering is harmless)", () => {
      const self = heapMarkersVite();
      expect(warnedFor([reactV6, self])).toBe(false);
    });
  });
});
