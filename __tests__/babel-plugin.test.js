const babel = require("@babel/core");
const plugin = require("../babel-plugin");

function transform(code, options = {}) {
  const result = babel.transformSync(code, {
    plugins: [[plugin, options]],
    filename: "Component.tsx", // Matches isReactFile
    babelrc: false,
    configFile: false,
    parserOpts: {
      plugins: ["jsx", "typescript"],
    },
  });
  return result.code;
}

describe("babel-plugin-heap-markers", () => {
  it("injects markers into functional components", () => {
    const code = `
      import React from "react";
      function MyComponent() {
        const handleClick = () => {
          console.log("clicked");
        };
        return <div onClick={handleClick}>Hello</div>;
      }
    `;
    const result = transform(code);
    
    // Check marker initialization
    expect(result).toContain("var _heap_ref_ = __heap_useRef(null);");
    expect(result).toContain("var _heap_ = _heap_ref_.current;");
    expect(result).toContain("function MyComponent$Heap()");
    expect(result).toContain('window.__heapTracker.track(_heap_ref_.current, "MyComponent")');

    // Check nested closure injection
    expect(result).toContain("_heap_ && 0;");
    expect(result).toContain('console.log("clicked");');
  });

  it("injects markers into arrow function components", () => {
    const code = `
      import React from "react";
      const ArrowComponent = () => {
        return <div />;
      };
    `;
    const result = transform(code);
    expect(result).toContain("ArrowComponent$Heap");
  });

  it("injects markers into hooks", () => {
    const code = `
      import { useState } from "react";
      function useCustomHook() {
        const [state, setState] = useState(0);
        return state;
      }
    `;
    const result = transform(code);
    expect(result).toContain("useCustomHook$Heap");
  });

  it("adds react imports if needed", () => {
    const code = `
      import * as React from "react";
      function MyComponent() {
        return <div />;
      }
    `;
    const result = transform(code);
    expect(result).toContain('import { useRef as __heap_useRef, useEffect as __heap_useEffect } from "react";');
  });

  it("ignores non-components (no JSX, not a hook)", () => {
    const code = `
      function helperFunction() {
        return "Not a component";
      }
    `;
    const result = transform(code);
    expect(result).not.toContain("$Heap");
  });

  it("converts arrow expression bodies to block bodies", () => {
    const code = `
      import React from "react";
      const ShortComponent = () => <div />;
    `;
    const result = transform(code);
    expect(result).toContain("ShortComponent$Heap");
    expect(result).toContain("return <div />");
  });

  it("does not inject unmount tracker if excluded", () => {
    const code = `
      import React from "react";
      function IgnoredUnmount() {
        return <div />;
      }
    `;
    const result = transform(code, { excludeUnmountTracking: [/^Ignored/] });
    expect(result).toContain("IgnoredUnmount$Heap");
    // Should still have track() on mount
    expect(result).toContain("window.__heapTracker.track");
    // But shouldn't contain the effect call with "markUnmounted"
    expect(result).not.toContain("window.__heapTracker.markUnmounted");
  });

  it("handles closures inside object methods", () => {
    const code = `
      import React from "react";
      function MethodComponent() {
        const obj = {
          handler() {
             console.log("hello");
          }
        };
        return <div />;
      }
    `;
    const result = transform(code);
    // MethodComponent$Heap should be defined, and handler should have _heap_ && 0
    expect(result).toContain("_heap_ && 0;");
  });

  it("captures nested function declarations", () => {
    // A leak whose only retainer is a nested `function` declaration (e.g. an
    // event handler attached without cleanup) must still retain _heap_.
    const code = `
      import React from "react";
      function MyComponent() {
        function onResize() { doStuff(); }
        return <div />;
      }
    `;
    const result = transform(code);
    expect(result).toMatch(/function onResize\(\)\s*{\s*_heap_ && 0;/);
  });

  it("does not inject into its own synthetic unmount effect", () => {
    // The injected useEffect already references _heap_ (markMounted/markUnmounted),
    // so Phase 2 must not add `_heap_ && 0` into it — and must not double-inject.
    const code = `
      import React from "react";
      function MyComponent() {
        const handleClick = () => { console.log("click"); };
        return <div onClick={handleClick} />;
      }
    `;
    const result = transform(code);
    // Exactly one capture: the single user closure (handleClick).
    expect((result.match(/_heap_ && 0;/g) || []).length).toBe(1);
  });
});
