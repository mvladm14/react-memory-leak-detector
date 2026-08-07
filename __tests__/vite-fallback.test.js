// The README/CHANGELOG promise that when `engine` is omitted the plugin prefers
// Oxc but falls back to Babel if `oxc-parser` can't be *loaded* (unsupported
// Node, missing native binding) — not merely if it can't be resolved. Simulate
// an unloadable Oxc engine and assert the auto-detect path degrades to Babel.

jest.mock("../lib/engine-oxc", () => {
  const OXC_UNAVAILABLE = "ERR_HEAP_OXC_UNAVAILABLE";
  const factory = () => ({
    name: "react-memory-leak-detector",
    enforce: "pre",
    apply: "serve",
    async transform() {
      const err = new Error("simulated: oxc-parser native binding missing");
      err.code = OXC_UNAVAILABLE;
      throw err;
    },
  });
  factory.OXC_UNAVAILABLE = OXC_UNAVAILABLE;
  return factory;
});

const heapMarkersVite = require("../vite");
const { oxcAvailable } = require("./oxc-available");

// The auto-detect → Oxc-chosen → load-fails → Babel path is only reachable when
// `oxc-parser` is resolvable (so resolveEngine picks "oxc" up front). Where it
// isn't installable (Node < 20.19, e.g. the CI Node 18 leg), auto-detect goes
// straight to Babel with no fallback warning, so that specific test is gated.
const itOxc = oxcAvailable ? it : it.skip;

const COMPONENT = `
  import React from "react";
  function MyComponent() {
    return <div>Hello</div>;
  }
`;

describe("auto-detect fallback to Babel when Oxc can't load", () => {
  itOxc("produces Babel-engine markers and warns once", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    // No `engine` → auto-detect → Oxc chosen, then fails to load → Babel.
    const plugin = heapMarkersVite({});
    const result = await plugin.transform(
      COMPONENT,
      "/app/src/MyComponent.tsx",
    );

    expect(result).not.toBeNull();
    expect(result.code).toContain("function MyComponent$Heap()");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/falling back to "babel"/);

    // A second file keeps using Babel without re-warning.
    const again = await plugin.transform(COMPONENT, "/app/src/Other.tsx");
    expect(again.code).toContain("function MyComponent$Heap()");
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
    log.mockRestore();
  });

  it("respects an explicit engine: 'oxc' by surfacing the load error", async () => {
    // Forced Oxc must NOT silently switch engines — the error propagates.
    const plugin = heapMarkersVite({ engine: "oxc", silent: true });
    await expect(
      plugin.transform(COMPONENT, "/app/src/MyComponent.tsx"),
    ).rejects.toThrow(/native binding missing/);
  });
});
