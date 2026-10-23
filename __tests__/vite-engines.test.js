const heapMarkersVite = require("../vite");
const { oxcAvailable } = require("./oxc-available");

// Tests that force (or assume) the Oxc engine can't run where oxc-parser isn't
// installable (Node < 20.19, e.g. the CI Node 18 leg). Gate them so they skip
// there instead of failing; Babel-only tests always run.
const itOxc = oxcAvailable ? it : it.skip;
const describeOxc = oxcAvailable ? describe : describe.skip;

// The Vite `transform` hook never references `this`, so we can call it plainly.
// Both engines' transforms are async, so every call is awaited.
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

// Substrings both engines must emit identically — the marker shapes the runtime
// tracker and heap-snapshot workflow depend on.
function expectMarkers(code, name) {
  expect(code).toContain(`function ${name}$Heap()`);
  expect(code).toContain("var _heap_ = _heap_ref_.current;");
  expect(code).toContain(
    `window.__heapTracker.track(_heap_ref_.current, "${name}")`,
  );
}

describe("engine selection", () => {
  it("forces the Babel engine with engine: 'babel'", async () => {
    const result = await transform(
      heapMarkersVite({ engine: "babel" }),
      COMPONENT,
      "/app/src/MyComponent.tsx",
    );
    expect(result).not.toBeNull();
    expectMarkers(result.code, "MyComponent");
  });

  itOxc("forces the Oxc engine with engine: 'oxc'", async () => {
    const result = await transform(
      heapMarkersVite({ engine: "oxc" }),
      COMPONENT,
      "/app/src/MyComponent.tsx",
    );
    expect(result).not.toBeNull();
    expectMarkers(result.code, "MyComponent");
  });

  itOxc("both engines emit runtime config on a component-less react file", async () => {
    // A file that imports React but declares no component/hook. With a
    // non-default option the config block must still be emitted, and both
    // engines must agree — otherwise config coverage depends on which engine ran.
    const noComponent = `
      import React from "react";
      export const VERSION = React.version;
    `;
    const oxc = await transform(
      heapMarkersVite({ engine: "oxc", leakAgeMs: 5000 }),
      noComponent,
      "/app/src/version.ts",
    );
    const babel = await transform(
      heapMarkersVite({ engine: "babel", leakAgeMs: 5000 }),
      noComponent,
      "/app/src/version.ts",
    );
    expect(oxc).not.toBeNull();
    expect(babel).not.toBeNull();
    expect(oxc.code).toContain("__heapTrackerOptions");
    expect(oxc.code).toContain("leakAgeMs: 5000");
    expect(babel.code).toContain("__heapTrackerOptions");
    expect(babel.code).toContain("leakAgeMs: 5000");
    // No markers, since there is nothing to instrument.
    expect(oxc.code).not.toContain("$Heap");
    expect(babel.code).not.toContain("$Heap");
  });

  itOxc("both engines leave a component-less react file untouched at default options", async () => {
    const noComponent = `
      import React from "react";
      export const VERSION = React.version;
    `;
    const oxc = await transform(
      heapMarkersVite({ engine: "oxc" }),
      noComponent,
      "/app/src/version.ts",
    );
    const babel = await transform(
      heapMarkersVite({ engine: "babel" }),
      noComponent,
      "/app/src/version.ts",
    );
    expect(oxc).toBeNull();
    expect(babel).toBeNull();
  });

  itOxc("both engines agree on the injected marker substrings", async () => {
    const oxc = await transform(
      heapMarkersVite({ engine: "oxc" }),
      COMPONENT,
      "/app/src/MyComponent.tsx",
    );
    const babel = await transform(
      heapMarkersVite({ engine: "babel" }),
      COMPONENT,
      "/app/src/MyComponent.tsx",
    );
    for (const s of [
      "function MyComponent$Heap()",
      "var _heap_ = _heap_ref_.current;",
      '__heapTracker.track(_heap_ref_.current, "MyComponent")',
      "_heap_ && 0;",
    ]) {
      expect(oxc.code).toContain(s);
      expect(babel.code).toContain(s);
    }
  });

  itOxc("both engines capture every nested closure kind exactly once", async () => {
    // One nested closure of each kind, plus the synthetic unmount effect. Both
    // engines must inject `_heap_ && 0` into all three USER closures — including
    // the `function helper()` declaration — and into NEITHER of the effect's own
    // arrows (they already reference _heap_). Asserting the exact count guards
    // the parity that a `.toContain` check silently misses.
    const mixed = `
      import React from "react";
      function MyComponent() {
        const handleClick = () => { console.log("click"); };
        function helper() { doStuff(); }
        const obj = { method() { return 1; } };
        return <div onClick={handleClick}>Hello</div>;
      }
    `;
    const count = (code) => (code.match(/_heap_ && 0;/g) || []).length;
    const oxc = await transform(
      heapMarkersVite({ engine: "oxc" }),
      mixed,
      "/app/src/MyComponent.tsx",
    );
    const babel = await transform(
      heapMarkersVite({ engine: "babel" }),
      mixed,
      "/app/src/MyComponent.tsx",
    );
    expect(count(oxc.code)).toBe(3);
    expect(count(babel.code)).toBe(3);
    // The nested function declaration specifically must be instrumented (the
    // Babel engine previously skipped `FunctionDeclaration` closures).
    expect(oxc.code).toMatch(/function helper\(\)\s*{\s*_heap_ && 0;/);
    expect(babel.code).toMatch(/function helper\(\)\s*{\s*_heap_ && 0;/);
  });
});

describe("Babel engine specifics", () => {
  const decorated = `
    import React from "react";
    function deco(target) { return target; }
    @deco
    class Thing {}
    function MyComp() {
      return <div />;
    }
  `;

  it("needs parserPlugins for non-default syntax (decorators)", async () => {
    // Babel's parser can't handle the decorator without the plugin opted in.
    await expect(
      transform(
        heapMarkersVite({ engine: "babel" }),
        decorated,
        "/app/src/Thing.tsx",
      ),
    ).rejects.toThrow();

    const result = await transform(
      heapMarkersVite({ engine: "babel", parserPlugins: ["decorators-legacy"] }),
      decorated,
      "/app/src/Thing.tsx",
    );
    expect(result).not.toBeNull();
    expect(result.code).toContain("MyComp$Heap");
  });
});

describeOxc("Oxc engine specifics", () => {
  const oxc = () => heapMarkersVite({ engine: "oxc" });

  it("parses decorators natively without parserPlugins", async () => {
    const decorated = `
      import React from "react";
      function deco(target) { return target; }
      @deco
      class Thing {}
      function MyComp() { return <div />; }
    `;
    const result = await transform(oxc(), decorated, "/app/src/Thing.tsx");
    expect(result).not.toBeNull();
    expect(result.code).toContain("MyComp$Heap");
  });

  it("wraps an expression-body arrow component and preserves JSX/TS", async () => {
    const tsx = `
      import React from "react";
      const Card = (props: { title: string }) => <div className="card">{props.title}</div>;
    `;
    const result = await transform(oxc(), tsx, "/app/src/Card.tsx");
    expect(result).not.toBeNull();
    expectMarkers(result.code, "Card");
    // Original JSX + TS preserved for the downstream transformer.
    expect(result.code).toContain('<div className="card">');
    expect(result.code).toContain("title: string");
    expect(result.code).not.toMatch(/_?jsxDEV|_?jsxs?\(/);
  });

  it("instruments a custom hook in a .ts file (no JSX required)", async () => {
    const ts = `
      import { useState } from "react";
      export function useCounter() {
        const [n, setN] = useState(0);
        const inc = () => setN((x) => x + 1);
        return { n, inc };
      }
    `;
    const result = await transform(oxc(), ts, "/app/src/useCounter.ts");
    expect(result).not.toBeNull();
    expectMarkers(result.code, "useCounter");
    // Nested closure captured.
    expect(result.code).toContain("_heap_ && 0;");
  });

  it("unwraps memo() and forwardRef() component wrappers", async () => {
    const memo = `
      import React, { memo, forwardRef } from "react";
      const A = memo(() => <div />);
      const B = forwardRef((props, ref) => <div ref={ref} />);
    `;
    const result = await transform(oxc(), memo, "/app/src/Wrapped.tsx");
    expect(result.code).toContain("A$Heap");
    expect(result.code).toContain("B$Heap");
  });

  it("injects runtime config for non-default options", async () => {
    const result = await transform(
      heapMarkersVite({ engine: "oxc", leakAgeMs: 5000 }),
      COMPONENT,
      "/app/src/MyComponent.tsx",
    );
    expect(result.code).toContain("__heapTrackerOptions");
    expect(result.code).toContain("leakAgeMs: 5000");
  });

  it("returns a usable sourcemap", async () => {
    const result = await transform(oxc(), COMPONENT, "/app/src/MyComponent.tsx");
    expect(result.map).toBeTruthy();
    expect(result.map.mappings).toEqual(expect.any(String));
  });

  it("aligns offsets with multibyte source", async () => {
    const code = `
      import React from "react";
      function Wide() {
        const label = "café — 𝟙 unit";
        const onClick = () => { console.log(label); };
        return <button onClick={onClick}>{label}</button>;
      }
    `;
    const result = await transform(oxc(), code, "/app/src/Wide.tsx");
    expect(result).not.toBeNull();
    // The marker landed at the body open, not mid-token — the original string
    // literal is still intact and the closure capture was injected.
    expect(result.code).toContain('"café — 𝟙 unit"');
    expect(result.code).toContain("Wide$Heap");
    expect(result.code).toContain("_heap_ && 0;");
  });
});

describe("default-parameter closures (both engines)", () => {
  // Closures in an instrumented function's OWN parameter list can't see the
  // body's `var _heap_` (parameter expressions get a separate environment), so
  // injecting `_heap_ && 0` there throws ReferenceError when the default runs.
  // Both engines must leave those closures alone and still capture body ones.
  const count = (code) => (code.match(/_heap_ && 0;/g) || []).length;

  const defaultProp = `
    import React from "react";
    export function Item({ label, onSelect = () => {} }) {
      return <button onClick={() => onSelect(label)}>{label}</button>;
    }
  `;
  const defaultHookParam = `
    import { useMemo } from "react";
    export function useFormat(fmt = (v) => String(v)) {
      return useMemo(() => fmt, [fmt]);
    }
  `;
  const nestedHelper = `
    import React from "react";
    export function Item() {
      const helper = (cb = () => {}) => cb();
      return <div onClick={() => helper()} />;
    }
  `;

  const nestedComponent = `
    import React from "react";
    export function Outer() {
      function Inner({ onSelect = () => {} }) {
        return <button onClick={onSelect} />;
      }
      return <Inner />;
    }
  `;

  for (const engine of ["babel", "oxc"]) {
    const run = engine === "oxc" ? itOxc : it;

    run(`${engine}: never captures in a nested instrumented function's own params`, async () => {
      // Inner is itself instrumented and sits inside instrumented Outer. Its
      // default closure could legally see Outer's _heap_, but both engines
      // must agree, and the simple deterministic rule is: an instrumented
      // function's own params are never captured.
      const { code } = await transform(
        heapMarkersVite({ engine }),
        nestedComponent,
        "/app/src/Outer.tsx",
      );
      expectMarkers(code, "Outer");
      expectMarkers(code, "Inner");
      expect(code).toContain("onSelect = () => {}");
      expect(count(code)).toBe(0);
    });

    run(`${engine}: leaves a component's default-callback prop untouched`, async () => {
      const { code } = await transform(
        heapMarkersVite({ engine }),
        defaultProp,
        "/app/src/Item.tsx",
      );
      expectMarkers(code, "Item");
      expect(code).toContain("onSelect = () => {}");
      expect(count(code)).toBe(1);
    });

    run(`${engine}: leaves a hook's default parameter untouched`, async () => {
      const { code } = await transform(
        heapMarkersVite({ engine }),
        defaultHookParam,
        "/app/src/useFormat.ts",
      );
      expect(code).toContain("function useFormat$Heap()");
      expect(code).toMatch(/fmt = \(?v\)? => String\(v\)/);
      expect(count(code)).toBe(1);
    });

    run(`${engine}: still captures defaults of nested non-instrumented functions`, async () => {
      const { code } = await transform(
        heapMarkersVite({ engine }),
        nestedHelper,
        "/app/src/Item.tsx",
      );
      expect(code).toMatch(/cb = \(\) => \{\s*_heap_ && 0;/);
      expect(count(code)).toBe(3);
    });
  }
});
