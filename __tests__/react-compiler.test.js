// The React Compiler must still compile instrumented components and hooks.
//
// The compiler bails out of a whole function on constructs it can't model,
// and it does so silently by default (panicThreshold "none"): the component
// just runs uncompiled. Our injected code once tripped two of those bail-outs
// — `var` declarations ("Handle var kinds in VariableDeclaration") and reading
// `ref.current` during render ("Cannot access refs during render") — so in
// dev every instrumented component ran uncompiled while production ran
// compiled code. Nothing failed; it only showed up in the compiler's logger.
//
// For each pipeline the detector supports, this compiles the same sources
// with and without instrumentation and requires the compiler to succeed on
// exactly the same number of functions, with no errors.
//
//   oxc pre-pass    — Vite plugin / Next.js wrapper, default engine: our
//                     transform runs first, the compiler sees its output.
//   babel pre-pass  — the same with the Babel engine (auto-detect fallback).
//   same pass       — the Babel plugin next to the compiler in one Babel
//                     config (webpack / .babelrc), in both plugin orders.

const babel = require("@babel/core");
const { createEngine } = require("../lib/engine");
const heapPlugin = require("../babel-plugin");
const { oxcAvailable } = require("./oxc-available");

const itOxc = oxcAvailable ? it : it.skip;

const COMPONENTS = `
  import React, { memo, forwardRef, useEffect, useState } from "react";

  export function Ticker({ items }) {
    const [n, setN] = useState(0);
    function current() {
      return n;
    }
    useEffect(() => {
      const id = setInterval(() => setN((x) => x + 1), 1000);
      return () => clearInterval(id);
    }, []);
    return (
      <ul onClick={() => setN(current() + 1)}>
        {items.map((s) => <li key={s}>{s}</li>)}
      </ul>
    );
  }

  export const Label = ({ text }) => <b>{text}</b>;

  export const Memoized = memo(({ value }) => <i>{value}</i>);

  export const Input = forwardRef((props, ref) => <input ref={ref} {...props} />);

  export function Item({ label, onSelect = () => {} }) {
    return <button onClick={() => onSelect(label)}>{label}</button>;
  }
`;

const HOOKS = `
  import { useEffect, useState } from "react";

  export function useInterval(ms) {
    const [n, setN] = useState(0);
    useEffect(() => {
      const id = setInterval(() => setN((x) => x + 1), ms);
      return () => clearInterval(id);
    }, [ms]);
    return n;
  }

  export const useDoubled = (x) => {
    const [y] = useState(() => x * 2);
    return y;
  };
`;

const SOURCES = [
  { file: "/app/src/Components.tsx", code: COMPONENTS, names: ["Ticker", "Label", "Memoized", "Input", "Item"] },
  { file: "/app/src/hooks.ts", code: HOOKS, names: ["useInterval", "useDoubled"] },
];

/** Runs Babel with the compiler (plus `plugins`) and returns its log + output. */
function compile(code, filename, { before = [], after = [] } = {}) {
  const events = [];
  const compiler = [
    "babel-plugin-react-compiler",
    {
      panicThreshold: "none",
      logger: { logEvent: (_file, event) => events.push(event) },
    },
  ];
  const out = babel.transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [["@babel/preset-typescript", { isTSX: true, allExtensions: true }]],
    plugins: [...before, compiler, ...after],
  }).code;
  const count = (kind) => events.filter((e) => e.kind === kind).length;
  const problems = events
    .filter((e) => e.kind !== "CompileSuccess")
    .map((e) => {
      const d = (e.detail && (e.detail.options || e.detail)) || {};
      return `${e.kind}: ${d.reason || e.reason || e.data || ""}`;
    });
  return { out, successes: count("CompileSuccess"), problems };
}

/** How many functions the compiler compiles in the uninstrumented source. */
function baseline({ code, file }) {
  const { successes, problems } = compile(code, file);
  expect(problems).toEqual([]);
  return successes;
}

function expectInstrumented(code, names) {
  for (const name of names) expect(code).toContain(`function ${name}$Heap()`);
}

describe("React Compiler compiles instrumented code", () => {
  it("baseline: the compiler compiles every component and hook in the fixtures", () => {
    // Guards the test itself: if the fixtures stopped being compilable, every
    // comparison below would pass vacuously.
    expect(baseline(SOURCES[0])).toBe(5);
    expect(baseline(SOURCES[1])).toBe(2);
  });

  describe.each([
    ["oxc pre-pass", "oxc"],
    ["babel pre-pass", "babel"],
  ])("%s (Vite plugin / Next.js wrapper order)", (_label, engine) => {
    const run = engine === "oxc" ? itOxc : it;
    run.each(SOURCES.map((s) => [s.file, s]))("%s", async (_file, source) => {
      const pre = await createEngine({ engine, silent: true }).transform(
        source.code,
        source.file,
      );
      expectInstrumented(pre.code, source.names);

      const { out, successes, problems } = compile(pre.code, source.file);
      expect(problems).toEqual([]);
      expect(successes).toBe(baseline(source));
      expect(out).toContain("react/compiler-runtime");
    });
  });

  describe.each([
    ["heap plugin listed first", "before"],
    ["compiler listed first", "after"],
  ])("same Babel pass, %s", (_label, where) => {
    it.each(SOURCES.map((s) => [s.file, s]))("%s", (_file, source) => {
      const { out, successes, problems } = compile(source.code, source.file, {
        [where]: [[heapPlugin, {}]],
      });
      expectInstrumented(out, source.names);
      expect(problems).toEqual([]);
      expect(successes).toBe(baseline(source));
    });
  });
});
