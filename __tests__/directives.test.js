// Directive prologues must survive instrumentation. A directive only counts
// while it precedes every other statement, so injecting code in front of it
// silently demotes it to a plain string: a Next.js `"use client"` file would
// become a Server Component, a React Compiler `"use no memo"` opt-out would be
// ignored. Both engines must splice their code AFTER the prologue. We check by
// re-parsing the output, so the assertion is about real directives, not text.
const { parse } = require("@babel/parser");
const heapMarkersVite = require("../vite");
const { oxcAvailable } = require("./oxc-available");

const engines = oxcAvailable ? ["babel", "oxc"] : ["babel"];

function parseOut(code) {
  return parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
}

function fnNamed(ast, name) {
  return ast.program.body
    .map((n) => (n.type === "ExportNamedDeclaration" ? n.declaration : n))
    .find((n) => n && n.type === "FunctionDeclaration" && n.id.name === name);
}

describe.each(engines)("directive prologues (%s engine)", (engine) => {
  const run = (code, opts = {}) =>
    heapMarkersVite({ engine, silent: true, ...opts }).transform(
      code,
      "/app/src/Widget.tsx",
    );

  it('keeps a module-level "use client" first', async () => {
    const result = await run(`"use client";
import { useState } from "react";
export function Widget() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}
`);
    const ast = parseOut(result.code);
    expect(ast.program.directives.map((d) => d.value.value)).toEqual([
      "use client",
    ]);
    expect(result.code).toContain("function Widget$Heap()");
  });

  it("keeps every directive of a multi-directive prologue, without semicolons", async () => {
    const result = await run(`'use client'
'use strict'
import React from "react";
export function Widget() {
  return <div />;
}
`);
    const ast = parseOut(result.code);
    expect(ast.program.directives.map((d) => d.value.value)).toEqual([
      "use client",
      "use strict",
    ]);
  });

  it("keeps the prologue when only the runtime-config block is injected", async () => {
    // No component/hook in the file, but non-default options still emit the
    // window.__heapTrackerOptions block.
    const result = await run(
      `"use client";
import { createContext } from "react";
export const Ctx = createContext(null);
`,
      { leakAgeMs: 5000 },
    );
    const ast = parseOut(result.code);
    expect(ast.program.directives.map((d) => d.value.value)).toEqual([
      "use client",
    ]);
    expect(result.code).toContain("leakAgeMs: 5000");
  });

  it("keeps function-level directives in components and nested closures", async () => {
    const result = await run(`import React from "react";
export function Widget() {
  "use no memo";
  function helper() {
    "use strict"
    return 1;
  }
  return <div onClick={helper} />;
}
`);
    const ast = parseOut(result.code);
    const widget = fnNamed(ast, "Widget");
    expect(widget.body.directives.map((d) => d.value.value)).toEqual([
      "use no memo",
    ]);
    // The marker is still injected, right after the directive.
    expect(widget.body.body[0].declarations[0].id.name).toBe("_heap_");

    const helper = widget.body.body.find(
      (n) => n.type === "FunctionDeclaration" && n.id.name === "helper",
    );
    expect(helper.body.directives.map((d) => d.value.value)).toEqual([
      "use strict",
    ]);
    // ...and the closure still captures _heap_.
    expect(result.code).toMatch(/"use strict";?\s*_heap_ && 0;/);
  });
});
