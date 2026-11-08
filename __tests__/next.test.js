// react-memory-leak-detector/next: the config wrapper and its loader.
//
// The wrapper must (a) never require a .babelrc — that breaks Next (JSX/TS stop
// compiling without `next/babel`, and under webpack SWC is disabled, breaking
// `next/font`), and (b) never instrument React Server Components, which can't
// call the injected useRef/useEffect. It does both by registering a pre-loader
// for the development browser compilation only. Real Next.js builds are covered
// manually (see CHANGELOG); these tests pin the config it produces and run the
// loader against the real engines.
const fs = require("fs");
const os = require("os");
const path = require("path");
const withHeapMarkers = require("../next");
const loader = require("../lib/next-loader");
const { serializeOptions, reviveOptions } = require("../lib/next-options");
const { oxcAvailable } = require("./oxc-available");

const LOADER_PATH = path.resolve(__dirname, "../lib/next-loader.js");
const GLOB = "*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}";

const COMPONENT = `"use client";
import { useEffect, useState } from "react";
export default function Ticker() {
  const [n, setN] = useState(0);
  useEffect(() => {
    setInterval(() => setN((x) => x + 1), 1000);
  }, []);
  return <p>{n}</p>;
}
`;

/** Pretend the app has `next@version` installed (the wrapper reads it from cwd). */
function withNextVersion(version, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heap-next-"));
  fs.mkdirSync(path.join(dir, "node_modules", "next"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "node_modules", "next", "package.json"),
    JSON.stringify({ name: "next", version }),
  );
  const cwd = jest.spyOn(process, "cwd").mockReturnValue(dir);
  try {
    return fn();
  } finally {
    cwd.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs the webpack hook the way Next does and returns the resulting rules. */
function webpackRules(config, ctx) {
  return config.webpack({ module: { rules: [] } }, ctx).module.rules;
}

/** Calls the loader with a minimal webpack/Turbopack loader context. */
function runLoader(source, { options = {}, resourcePath } = {}) {
  return new Promise((resolve, reject) => {
    // Only public loader-context members: the loader must not depend on
    // webpack internals such as `this._module`.
    const ctx = {
      resourcePath,
      getOptions: () => options,
      async: () => (err, code, map) =>
        err ? reject(err) : resolve({ code, map }),
    };
    loader.call(ctx, source, undefined);
  });
}

describe("withHeapMarkers (next config)", () => {
  it("preserves the user's config and adds no Babel config", () => {
    const config = withHeapMarkers({ reactStrictMode: true, images: { unoptimized: true } });
    expect(config.reactStrictMode).toBe(true);
    expect(config.images).toEqual({ unoptimized: true });
    expect(typeof config.webpack).toBe("function");
  });

  it("adds a pre-loader only to the development browser compilation", () => {
    const config = withHeapMarkers({});
    const devClient = webpackRules(config, { dev: true, isServer: false });
    expect(devClient).toHaveLength(1);
    expect(devClient[0]).toMatchObject({ enforce: "pre" });
    expect(devClient[0].use[0].loader).toBe(LOADER_PATH);
    expect(devClient[0].test.test("/app/page.tsx")).toBe(true);
    expect(devClient[0].exclude.test("/app/node_modules/x/index.js")).toBe(true);

    // Server compilations (RSC + SSR) and production builds are untouched.
    expect(webpackRules(config, { dev: true, isServer: true })).toHaveLength(0);
    expect(webpackRules(config, { dev: false, isServer: false })).toHaveLength(0);
  });

  it("chains a user webpack() hook", () => {
    const userWebpack = jest.fn((cfg) => {
      cfg.module.rules.push({ test: /\.svg$/ });
      return cfg;
    });
    const config = withHeapMarkers({ webpack: userWebpack });
    const ctx = { dev: true, isServer: false };
    const rules = webpackRules(config, ctx);
    expect(userWebpack).toHaveBeenCalledWith(expect.any(Object), ctx);
    expect(rules.map((r) => String(r.test))).toEqual([
      String(/\.[cm]?[jt]sx?$/),
      String(/\.svg$/),
    ]);
  });

  it("registers a browser + development + non-node_modules Turbopack rule on Next >= 16", () => {
    const config = withNextVersion("16.0.0", () => withHeapMarkers({}));
    expect(config.turbopack.rules[GLOB]).toEqual({
      loaders: [{ loader: LOADER_PATH, options: {} }],
      condition: { all: ["browser", "development", { not: "foreign" }] },
    });
  });

  it("falls back to \"use client\" files only on Next 15.3–15.x Turbopack", () => {
    // Turbopack 15.x ignores the `browser` condition, so the loader would also
    // see Server Components; only "use client" files are safe everywhere.
    const config = withNextVersion("15.5.6", () =>
      withHeapMarkers({}, { leakAgeMs: 5000 }),
    );
    const rule = config.turbopack.rules[GLOB];
    expect(rule.condition).toBeUndefined();
    expect(rule.loaders[0].options).toEqual({
      leakAgeMs: 5000,
      skipServerComponents: true,
    });
  });

  it("adds no Turbopack config before Next 15.3, and warns under Turbopack", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const prev = process.env.TURBOPACK;
    process.env.TURBOPACK = "1";
    try {
      const config = withNextVersion("14.2.35", () => withHeapMarkers({}));
      expect(config.turbopack).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/Turbopack needs Next\.js >= 15\.3/);
    } finally {
      if (prev === undefined) delete process.env.TURBOPACK;
      else process.env.TURBOPACK = prev;
      warn.mockRestore();
    }
  });

  it("keeps existing Turbopack options and rules", () => {
    const svg = { loaders: ["@svgr/webpack"], as: "*.js" };
    const mine = { loaders: ["some-loader"] };
    const config = withNextVersion("16.1.0", () =>
      withHeapMarkers({
        turbopack: { resolveAlias: { a: "b" }, rules: { "*.svg": svg, [GLOB]: mine } },
      }),
    );
    expect(config.turbopack.resolveAlias).toEqual({ a: "b" });
    expect(config.turbopack.rules["*.svg"]).toBe(svg);
    expect(config.turbopack.rules[GLOB]).toHaveLength(2);
    expect(config.turbopack.rules[GLOB][0]).toBe(mine);
  });

  it("passes options as JSON (Turbopack requirement), encoding RegExps", () => {
    const config = withNextVersion("16.0.0", () =>
      withHeapMarkers({}, { excludeNames: [/^useX$/i], leakAgeMs: 5000 }),
    );
    const { options } = config.turbopack.rules[GLOB].loaders[0];
    expect(JSON.parse(JSON.stringify(options))).toEqual(options);
    expect(reviveOptions(options)).toEqual({
      excludeNames: [/^useX$/i],
      leakAgeMs: 5000,
    });
  });

  it("wraps a function-form next.config", async () => {
    const wrapped = withHeapMarkers(async (phase) => ({ env: { phase } }), {});
    const config = await wrapped("phase-development-server", {});
    expect(config.env).toEqual({ phase: "phase-development-server" });
    expect(typeof config.webpack).toBe("function");
  });

  it("is available as default and named export", () => {
    expect(withHeapMarkers.default).toBe(withHeapMarkers);
    expect(withHeapMarkers.withHeapMarkers).toBe(withHeapMarkers);
  });
});

describe("turbopackMode", () => {
  it.each([
    [null, "conditions"],
    [[16, 0], "conditions"],
    [[17, 2], "conditions"],
    [[15, 5], "use-client"],
    [[15, 3], "use-client"],
    [[15, 2], null],
    [[14, 2], null],
  ])("Next %p → %p", (version, mode) => {
    expect(withHeapMarkers.turbopackMode(version)).toBe(mode);
  });
});

describe("option (de)serialization", () => {
  it("round-trips nested RegExps and drops undefined", () => {
    const opts = {
      include: /\.tsx$/,
      excludeUnmountTracking: [/^Hidden/, /Panel$/g],
      trackHooks: false,
      exclude: undefined,
    };
    const encoded = serializeOptions(opts);
    expect(encoded).not.toHaveProperty("exclude");
    expect(reviveOptions(JSON.parse(JSON.stringify(encoded)))).toEqual({
      include: /\.tsx$/,
      excludeUnmountTracking: [/^Hidden/, /Panel$/g],
      trackHooks: false,
    });
  });
});

describe("next loader", () => {
  const engines = oxcAvailable ? ["babel", "oxc"] : ["babel"];

  it.each(engines)("instruments a client component (%s engine)", async (engine) => {
    const { code, map } = await runLoader(COMPONENT, {
      options: { engine, silent: true },
      resourcePath: "/app/components/Ticker.tsx",
    });
    expect(code).toContain("function Ticker$Heap()");
    expect(code.trimStart().startsWith('"use client"')).toBe(true);
    expect(map.sources).toHaveLength(1);
    expect(map.sourcesContent).toEqual([COMPONENT]);
  });

  it("applies RegExp options after serialization", async () => {
    const { code } = await runLoader(COMPONENT, {
      options: serializeOptions({ engine: "babel", silent: true, excludeNames: [/^Ticker$/] }),
      resourcePath: "/app/components/Ticker.tsx",
    });
    expect(code).toBe(COMPONENT);
  });

  it("honors skipServerComponents (Next 15 Turbopack fallback)", async () => {
    const serverFile = COMPONENT.replace('"use client";\n', "");
    const { code } = await runLoader(serverFile, {
      options: { engine: "babel", silent: true, skipServerComponents: true },
      resourcePath: "/app/components/Ticker.tsx",
    });
    expect(code).toBe(serverFile);
  });

  it("passes everything through in production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const { code } = await runLoader(COMPONENT, {
        options: { engine: "babel", silent: true },
        resourcePath: "/app/components/Ticker.tsx",
      });
      expect(code).toBe(COMPONENT);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("skips node_modules given a Windows path", async () => {
    const { code } = await runLoader(COMPONENT, {
      options: { engine: "babel", silent: true },
      resourcePath: "C:\\app\\node_modules\\ui\\Ticker.tsx",
    });
    expect(code).toBe(COMPONENT);
  });

  it("passes non-React files through untouched", async () => {
    const src = "export const x = 1;\n";
    const { code } = await runLoader(src, {
      options: { engine: "babel", silent: true },
      resourcePath: "/app/lib/x.ts",
    });
    expect(code).toBe(src);
  });

  it("surfaces transform errors through the loader callback", async () => {
    await expect(
      runLoader("import React from 'react'; export function A( { return <div/> }", {
        options: { engine: "babel", silent: true },
        resourcePath: "/app/A.tsx",
      }),
    ).rejects.toThrow();
  });
});
