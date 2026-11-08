// When the auto-detected Oxc engine can't be used, the dispatcher falls back to
// Babel, which needs @babel/core, an optional peer dependency that many apps
// (Next.js ones in particular) don't have. Without @babel/core, users must get
// ONE error that names both causes and both fixes, not a "@babel/core is
// required for the babel engine" error for an engine they never chose, nor a
// warning advising `engine: "babel"` right before that fails too.

let mockBabelAvailable = true;

jest.mock("../lib/engine-oxc", () => {
  const OXC_UNAVAILABLE = "ERR_HEAP_OXC_UNAVAILABLE";
  const factory = () => ({
    name: "react-memory-leak-detector",
    enforce: "pre",
    apply: "serve",
    async transform(code) {
      // Like the real engine: files that never mention react bail out before
      // oxc-parser is loaded.
      if (!code.includes("react")) return null;
      const err = new Error("full explicit-oxc message");
      err.code = OXC_UNAVAILABLE;
      err.reason = "simulated: native binding missing";
      throw err;
    },
  });
  factory.OXC_UNAVAILABLE = OXC_UNAVAILABLE;
  return factory;
});

jest.mock("../lib/engine-babel", () => {
  const BABEL_UNAVAILABLE = "ERR_HEAP_BABEL_UNAVAILABLE";
  const factory = () => ({
    name: "react-memory-leak-detector",
    enforce: "pre",
    apply: "serve",
    async transform(code) {
      if (!code.includes("react")) return null;
      if (!mockBabelAvailable) {
        const err = new Error('"@babel/core" is required when using the "babel" engine.');
        err.code = BABEL_UNAVAILABLE;
        throw err;
      }
      return { code: "/* babel */" + code, map: null };
    },
  });
  factory.BABEL_UNAVAILABLE = BABEL_UNAVAILABLE;
  factory.isAvailable = () => mockBabelAvailable;
  return factory;
});

// Loaded fresh per test: the "using <engine> engine" banner prints at most once
// per module instance, which would make banner assertions order-dependent.
let createEngine;
let NO_ENGINE;

const COMPONENT = 'import React from "react"; export function A() { return <div />; }';
const PLAIN = "export const x = 1;";
const FILE = "/app/src/A.tsx";

let warn;
let log;
beforeEach(() => {
  jest.isolateModules(() => {
    ({ createEngine, NO_ENGINE } = require("../lib/engine"));
  });
  mockBabelAvailable = true;
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  log = jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  log.mockRestore();
});

describe("oxc-parser installed but fails to load (auto-detect)", () => {
  it("without @babel/core: one combined error, and no misleading fallback warning", async () => {
    mockBabelAvailable = false;
    const engine = createEngine({});
    const error = await engine.transform(COMPONENT, FILE).catch((e) => e);
    expect(error.code).toBe(NO_ENGINE);
    expect(error.message).toContain("simulated: native binding missing");
    expect(error.message).toContain('"@babel/core"');
    expect(error.message).toMatch(/\^20\.19 or >=22\.12/);
    expect(error.message).not.toContain('pass engine: "babel"');
    expect(warn).not.toHaveBeenCalled();

    // Same error for the next file; files that never mention react still pass.
    await expect(engine.transform(COMPONENT, "/app/src/B.tsx")).rejects.toBe(error);
    await expect(engine.transform(PLAIN, "/app/src/x.ts")).resolves.toBeNull();
  });

  it("with @babel/core: falls back, warning with the reason but no `engine` advice", async () => {
    const engine = createEngine({});
    const result = await engine.transform(COMPONENT, FILE);
    expect(result.code).toContain("/* babel */");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/falling back to "babel"/);
    expect(warn.mock.calls[0][0]).toContain("simulated: native binding missing");
    expect(warn.mock.calls[0][0]).not.toContain('pass engine: "babel"');
  });
});

describe("oxc-parser not installed (auto-detect)", () => {
  const notInstalled = { oxcResolvable: () => false };

  it("without @babel/core: one combined error naming the missing oxc-parser", async () => {
    mockBabelAvailable = false;
    const engine = createEngine({}, notInstalled);
    const error = await engine.transform(COMPONENT, FILE).catch((e) => e);
    expect(error.code).toBe(NO_ENGINE);
    expect(error.message).toContain('"oxc-parser" is not installed');
    expect(error.message).toContain('"@babel/core"');
    // No "using babel engine" banner for an engine that can't run.
    expect(log).not.toHaveBeenCalled();
    await expect(engine.transform(PLAIN, "/app/src/x.ts")).resolves.toBeNull();
  });

  it("with @babel/core: uses Babel and announces it", async () => {
    const engine = createEngine({}, notInstalled);
    expect(log).toHaveBeenCalledWith('[react-memory-leak-detector] using "babel" engine');
    const result = await engine.transform(COMPONENT, FILE);
    expect(result.code).toContain("/* babel */");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('explicit engine: "babel"', () => {
  it("keeps Babel's own error: the user asked for that engine", async () => {
    mockBabelAvailable = false;
    const engine = createEngine({ engine: "babel" });
    const error = await engine.transform(COMPONENT, FILE).catch((e) => e);
    expect(error.code).toBe("ERR_HEAP_BABEL_UNAVAILABLE");
    expect(error.message).toContain('"@babel/core" is required');
  });
});

describe('explicit engine: "oxc"', () => {
  it("surfaces the engine's own error instead of switching engines", async () => {
    const engine = createEngine({ engine: "oxc" });
    const error = await engine.transform(COMPONENT, FILE).catch((e) => e);
    expect(error.code).toBe("ERR_HEAP_OXC_UNAVAILABLE");
    expect(warn).not.toHaveBeenCalled();
    // No "using oxc engine" banner for an engine that failed to load.
    expect(log).not.toHaveBeenCalled();
  });
});
