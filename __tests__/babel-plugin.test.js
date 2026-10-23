const babel = require("@babel/core");
const plugin = require("../babel-plugin");
const React = require("react");
// Loaded at module level: testing-library registers Jest lifecycle hooks on load.
const { render } = require("@testing-library/react");

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

  it("does not double-inject when run in the same pass as preset-react", () => {
    // In a same-pass setup (webpack/Next .babelrc, babel-jest) preset-react
    // replaces the JSXElement with a createElement() call and Babel re-queues
    // the new subtree, so an arrow inside a JSX attribute reaches our
    // ArrowFunctionExpression visitor a second time. The plugin must remember
    // which closures it already injected into. Parse-only runs (the `transform`
    // helper above) never re-visit, so this needs the real preset stack.
    const code = `
      import React from "react";
      export function Item({ label }) {
        const handle = () => console.log(label);
        return <button onClick={() => console.log(label)}>{label}</button>;
      }
    `;
    const result = babel.transformSync(code, {
      filename: "Item.tsx",
      babelrc: false,
      configFile: false,
      presets: [
        ["@babel/preset-env", { targets: { node: "current" } }],
        ["@babel/preset-react", { runtime: "classic" }],
        "@babel/preset-typescript",
      ],
      plugins: [[plugin, {}]],
    }).code;

    // Exactly two captures: one for `handle`, one for the onClick arrow.
    expect((result.match(/_heap_ && 0;/g) || []).length).toBe(2);
    expect(result).not.toMatch(/_heap_ && 0;\s*_heap_ && 0;/);
    expect(result).toContain("createElement");
  });
});

describe("default-parameter closures", () => {
  // A function with parameter expressions gets a separate environment for its
  // params: closures created there CANNOT see the body's `var _heap_`. Injecting
  // `_heap_ && 0` into a default-value closure therefore throws
  // `ReferenceError: _heap_ is not defined` the moment the default is invoked
  // (modules are strict). Default-callback props are a very common idiom, so
  // the plugin must leave the instrumented function's own params alone.

  it("leaves a component's default-callback prop untouched", () => {
    const code = `
      import React from "react";
      export function Item({ label, onSelect = () => {} }) {
        return <button onClick={() => onSelect(label)}>{label}</button>;
      }
    `;
    const result = transform(code);
    // Still instrumented…
    expect(result).toContain("function Item$Heap()");
    // …the default is emitted verbatim…
    expect(result).toContain("onSelect = () => {}");
    // …and the body closure is the only capture.
    expect(result).toMatch(/onClick=\{\(\) => \{\s*_heap_ && 0;/);
    expect((result.match(/_heap_ && 0;/g) || []).length).toBe(1);
  });

  it("leaves a hook's default parameter untouched", () => {
    const code = `
      import { useMemo } from "react";
      export function useFormat(fmt = (v) => String(v)) {
        return useMemo(() => fmt, [fmt]);
      }
    `;
    const result = transform(code);
    expect(result).toContain("function useFormat$Heap()");
    expect(result).toContain("fmt = v => String(v)");
    expect((result.match(/_heap_ && 0;/g) || []).length).toBe(1);
  });

  it("handles the arrow-component variant", () => {
    const code = `
      import React from "react";
      const Item = ({ onClick = () => 1 }) => <button onClick={() => onClick()} />;
    `;
    const result = transform(code);
    expect(result).toContain("function Item$Heap()");
    expect(result).toContain("onClick = () => 1");
    expect((result.match(/_heap_ && 0;/g) || []).length).toBe(1);
  });

  it("skips closures nested inside a default-parameter closure too", () => {
    // The inner `(x) => x` is also created in the parameter environment.
    const code = `
      import React from "react";
      export function List({ items, onSelect = () => items.map((x) => x) }) {
        return <div />;
      }
    `;
    const result = transform(code);
    expect(result).toContain("function List$Heap()");
    expect(result).not.toContain("_heap_ && 0;");
  });

  it("same pass with preset-env downleveling params: default stays uncaptured and renders", () => {
    // With old targets, @babel/preset-env's parameter transform runs on the
    // SAME Function node right after our Phase 1 visitor and moves the
    // defaults into the body, so Phase 2 can no longer tell from position
    // that they were params. The body binding `defaultLabel` shadows a name
    // used in the params, which makes the transform wrap the original body
    // (and our `var _heap_`) in an IIFE while the lowered default stays
    // outside — a capture there throws ReferenceError at render.
    const code = `
      import React from "react";
      const defaultLabel = "default";
      export function Item({ label = defaultLabel, onFormat = (s) => s + "!" }) {
        const defaultLabel = "inner";
        return <b onClick={() => onFormat(label)}>{onFormat(label)} {defaultLabel}</b>;
      }
    `;
    const out = babel.transformSync(code, {
      filename: "Item.tsx",
      babelrc: false,
      configFile: false,
      presets: [
        ["@babel/preset-env", { targets: { ie: 11 }, modules: "commonjs" }],
        ["@babel/preset-react", { runtime: "classic" }],
      ],
      plugins: [[plugin, {}]],
    }).code;
    expect(out).toContain("function Item$Heap()");
    // The lowered default `function (s) { ... }` must carry no capture. (The
    // onClick arrow inside the IIFE, and the IIFE itself, legitimately do.)
    expect(out).toMatch(/function \(s\) \{\s*return s \+ "!";/);
    expect(out).not.toMatch(/function \(s\) \{\s*_heap_ && 0;/);

    // And the compiled component actually renders: the default is invoked
    // during render, so a stray capture would throw here.
    const mod = { exports: {} };
    new Function("require", "module", "exports", out)(require, mod, mod.exports);
    const { container } = render(React.createElement(mod.exports.Item));
    expect(container.textContent).toContain("default!");
  });

  // Same-pass helper: compile with the given preset-env targets, then
  // evaluate the CommonJS output and render the exported Item.
  function compileAndRender(code, targets) {
    const out = babel.transformSync(code, {
      filename: "Item.tsx",
      babelrc: false,
      configFile: false,
      presets: [
        ["@babel/preset-env", { targets, modules: "commonjs" }],
        ["@babel/preset-react", { runtime: "classic" }],
        "@babel/preset-typescript",
      ],
      plugins: [[plugin, {}]],
    }).code;
    const mod = { exports: {} };
    new Function("require", "module", "exports", out)(require, mod, mod.exports);
    const { container } = render(React.createElement(mod.exports.Item));
    return { out, text: container.textContent };
  }

  it("same pass, non-arrow defaults (object method, class, generator) with downleveled params", () => {
    // These transforms build NEW function nodes (shorthand-properties,
    // classes, regenerator), so nothing attached to the original closure
    // survives; only the lexical marker-block rule gets this right. With the
    // body shadowing `d`, the lowered defaults sit outside the IIFE.
    const code = `
      import React from "react";
      const d = "x";
      export function Item({
        label = d,
        h = { m(cb) { return cb(); } },
        K = class { run() { return "k"; } },
        gen = function* () { yield "g"; },
      }) {
        const d = "inner";
        return <b>{h.m(() => "m")}{new K().run()}{[...gen()].join("")}{label}{d}</b>;
      }
    `;
    for (const targets of [{ ie: 11 }, {}]) {
      const { out, text } = compileAndRender(code, targets);
      expect(out).toContain("function Item$Heap()");
      // No capture in any lowered default: m(), run(), the generator.
      expect(out).not.toMatch(/function m\(cb\) \{\s*_heap_ && 0;/);
      expect(out).not.toMatch(/run\(\) \{\s*_heap_ && 0;/);
      expect(out).not.toMatch(/function gen\(\) \{\s*_heap_ && 0;/);
      expect(text).toBe("mkgxinner");
    }
  });

  it("same pass, params kept but an async default rewritten in place", () => {
    // Chrome 50 keeps destructured default parameters but lowers async
    // functions. async-to-generator rebuilds the closure as new nodes INSIDE
    // the param list; it is still a parameter closure and must stay
    // uncaptured. The body has no closures, so the output must have none.
    const code = `
      import React from "react";
      export function Item({ load = async () => "a" }) {
        return <b>{typeof load}</b>;
      }
    `;
    const { out, text } = compileAndRender(code, { chrome: "50" });
    expect(out).toContain("function Item$Heap()");
    expect(out).toMatch(/function Item\(\{/); // params were kept
    expect(out).toContain("_asyncToGenerator"); // the default was lowered in place
    expect(out).not.toContain("_heap_ && 0;");
    expect(text).toBe("function");
  });

  it("still captures defaults of nested non-instrumented functions", () => {
    // `helper`'s params live INSIDE the component body, where `var _heap_` is
    // visible — so capturing there is both safe and wanted.
    const code = `
      import React from "react";
      export function Item() {
        const helper = (cb = () => {}) => cb();
        return <div onClick={() => helper()} />;
      }
    `;
    const result = transform(code);
    expect(result).toMatch(/cb = \(\) => \{\s*_heap_ && 0;/);
    // helper itself, cb's default, and the onClick arrow.
    expect((result.match(/_heap_ && 0;/g) || []).length).toBe(3);
  });
});
