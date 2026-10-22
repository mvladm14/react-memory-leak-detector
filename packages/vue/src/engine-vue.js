/**
 * Oxc engine (Vue 3) for the memory-leak detector's Vite plugin.
 *
 * Instruments Vue 3 `<script setup>` Single-File Components. Same end result as
 * the React engine — a searchable `$Heap` marker per component instance, tracked
 * live via `window.__heapTracker`, with `_heap_ && 0` captured into every script
 * closure — but adapted to Vue's model, which is in two ways *simpler* than React:
 *
 *   1. A `<script setup>` block runs its body exactly ONCE per component
 *      instance (unlike a React function component, which re-runs every render).
 *      So there's no `useRef` stabilization dance — a plain
 *      `const _heap_ = new (function Name$Heap(){})()` already yields exactly one
 *      marker per instance.
 *   2. Lifecycle uses `onMounted`/`onUnmounted` imported from "vue" (aliased),
 *      in place of React's synthetic `useEffect`. These still drive
 *      `markMounted`/`markUnmounted`, which is what times the leak.
 *
 * `.vue` files are not parseable by oxc/babel directly, so we:
 *   1. Split the SFC with `@vue/compiler-sfc`'s `parse()` to locate the
 *      `<script setup>` block and its byte offset in the file.
 *   2. Parse the block's *content* with `oxc-parser`.
 *   3. Splice markers/closure-captures into a `magic-string` of the WHOLE `.vue`
 *      file, offsetting every AST position by the block's start offset. The
 *      `<template>`/`<style>` bytes are left untouched; `@vitejs/plugin-vue`
 *      compiles our already-injected script afterward.
 *
 * The generic machinery (ESTree walk, body-prepend splicing, tracker-call guard,
 * runtime-config block) is shared with the React engine via `@memleak/core`.
 *
 * Requires `oxc-parser`, `magic-string`, and `@vue/compiler-sfc`.
 */
const {
  walk,
  FUNCTION_TYPES,
  trackerCall,
  prependInBody,
  CLOSURE_CAPTURE,
  emitsConfig,
  configSource,
  isExcludedName,
} = require("@memleak/core");

// Tagged like the React engine's failure so the `../vue.js` entry can surface an
// actionable message. Vue rides the Oxc engine only (there's no Vue Babel
// engine), so a load failure is fatal for the Vue plugin rather than a fallback.
const VUE_DEPS_UNAVAILABLE = "ERR_HEAP_VUE_DEPS_UNAVAILABLE";

let depsPromise;
function loadDeps() {
  if (!depsPromise) {
    depsPromise = Promise.all([
      import("oxc-parser"),
      import("magic-string"),
      import("@vue/compiler-sfc"),
    ])
      .then(([oxc, ms, sfc]) => ({
        parseSync: oxc.parseSync,
        MagicString: ms.default || ms.MagicString,
        parseSFC: sfc.parse,
      }))
      .catch((err) => {
        depsPromise = undefined;
        const wrapped = new Error(
          "[memory-leak-detector] the Vue plugin needs oxc-parser, magic-string, " +
            "and @vue/compiler-sfc. Install @vue/compiler-sfc (it ships with Vue) " +
            `and ensure oxc-parser loads on this platform. Original error: ${
              (err && err.message) || err
            }`,
        );
        wrapped.code = VUE_DEPS_UNAVAILABLE;
        throw wrapped;
      });
  }
  return depsPromise;
}

const ON_MOUNTED_ALIAS = "__heap_onMounted";
const ON_UNMOUNTED_ALIAS = "__heap_onUnmounted";

/** `.vue` file gate (query suffix already stripped by the caller). */
function isVueFile(file) {
  return /\.vue$/.test(file);
}

/** oxc infers the source language from the filename extension we hand it. */
function extForLang(lang) {
  if (lang === "ts") return "ts";
  if (lang === "tsx") return "tsx";
  if (lang === "jsx") return "jsx";
  return "js";
}

/** Turn an arbitrary component name into a valid JS identifier for the marker. */
function sanitizeIdent(name) {
  let id = String(name).replace(/[^A-Za-z0-9_$]/g, "_");
  if (/^[0-9]/.test(id)) id = "_" + id;
  return id || "_";
}

/** `Foo.vue` → `Foo` (basename without extension). */
function basename(file) {
  const base = file.split(/[\\/]/).pop() || file;
  return base.replace(/\.vue$/, "");
}

/**
 * Component name from an explicit `defineOptions({ name: "X" })` in the script
 * block, else the filename basename. Mirrors how Vue itself resolves the name.
 */
function resolveName(program, file) {
  for (const n of program.body) {
    const expr = n.type === "ExpressionStatement" ? n.expression : null;
    if (
      expr &&
      expr.type === "CallExpression" &&
      expr.callee.type === "Identifier" &&
      expr.callee.name === "defineOptions" &&
      expr.arguments &&
      expr.arguments[0] &&
      expr.arguments[0].type === "ObjectExpression"
    ) {
      for (const prop of expr.arguments[0].properties) {
        if (
          prop.type === "Property" &&
          !prop.computed &&
          ((prop.key.type === "Identifier" && prop.key.name === "name") ||
            (prop.key.type === "Literal" && prop.key.value === "name")) &&
          prop.value.type === "Literal" &&
          typeof prop.value.value === "string"
        ) {
          return prop.value.value;
        }
      }
    }
  }
  return basename(file);
}

/** The Vue marker block: a plain const (setup runs once) + onMounted/onUnmounted. */
function markerSource(name, withEffect) {
  const ident = sanitizeIdent(name) + "$Heap";
  let src =
    `const _heap_ = new (function ${ident}() {})();` +
    trackerCall("track", `_heap_, ${JSON.stringify(name)}`) +
    `;`;
  if (withEffect) {
    src +=
      `${ON_MOUNTED_ALIAS}(() => { ` +
      trackerCall("markMounted", "_heap_") +
      `; });` +
      `${ON_UNMOUNTED_ALIAS}(() => { ` +
      trackerCall("markUnmounted", "_heap_") +
      `; });`;
  }
  return src;
}

module.exports = function heapMarkersViteVue(options = {}) {
  const {
    include = /\.vue$/,
    exclude,
    apply = "serve",
    excludeNames = [],
    excludeUnmountTracking = [],
    logging = true,
    leakAgeMs = 10000,
    suspectThreshold = 1,
    sweepIntervalMs = 2000,
    warnCooldownMs = 30000,
  } = options;

  const isExcludedFromUnmountTracking = (name) =>
    excludeUnmountTracking.some((re) => re.test(name));

  const configOpts = {
    logging,
    leakAgeMs,
    suspectThreshold,
    sweepIntervalMs,
    warnCooldownMs,
  };
  const emitConfig = emitsConfig(configOpts);

  return {
    name: "memory-leak-detector-vue",
    enforce: "pre",
    apply,
    async transform(code, id) {
      if (id.includes("\0")) return null;
      const file = id.split("?", 1)[0];
      if (file.includes("/node_modules/")) return null;
      // Only bare `.vue` requests. Vite re-requests the SFC's sub-blocks with a
      // `?vue&type=script|template|style` query; those must pass through
      // untouched (we already injected into the source they were split from).
      if (id.includes("?vue") || id.includes("&vue")) return null;
      if (!isVueFile(file) || !include.test(file)) return null;
      if (exclude && exclude.test(file)) return null;

      const { parseSync, MagicString, parseSFC } = await loadDeps();

      const { descriptor, errors } = parseSFC(code, { filename: file });
      if (errors && errors.length) return null;
      const block = descriptor.scriptSetup;
      // This pass instruments `<script setup>` SFCs only. Options-API / plain
      // `<script>` / template-only components are left untouched.
      if (!block) return null;

      const base = block.loc.start.offset;
      const parsed = parseSync(`sfc.${extForLang(block.lang)}`, block.content);
      // Bail quietly on parse errors; plugin-vue will surface a real diagnostic.
      if (parsed.errors && parsed.errors.length) return null;
      const program = parsed.program;

      const name = resolveName(program, file);
      if (isExcludedName(name, excludeNames)) return null;
      const withEffect = !isExcludedFromUnmountTracking(name);

      const s = new MagicString(code);

      // ── Prelude: aliased vue import (only if we emit lifecycle) + optional
      //    runtime-config block + the marker — inserted after the block's last
      //    top-level import so hooks register before any top-level `await`. ──
      let insertRel = 0;
      for (const n of program.body) {
        if (n.type === "ImportDeclaration") insertRel = n.end;
      }
      const prelude = [];
      if (withEffect) {
        prelude.push(
          `import { onMounted as ${ON_MOUNTED_ALIAS}, onUnmounted as ${ON_UNMOUNTED_ALIAS} } from "vue";`,
        );
      }
      if (emitConfig) prelude.push(configSource(configOpts));
      prelude.push(markerSource(name, withEffect));
      s.appendLeft(base + insertRel, "\n" + prelude.join("\n") + "\n");

      // ── Closure capture: `_heap_ && 0;` into every function defined in the
      //    script block. The whole block body is the component instance scope,
      //    so every closure (top-level handlers included) can retain the marker. ──
      walk(program, null, (node) => {
        if (FUNCTION_TYPES.has(node.type)) {
          prependInBody(s, node, CLOSURE_CAPTURE, base);
        }
      });

      return {
        code: s.toString(),
        map: s.generateMap({ hires: true, source: file }),
      };
    },
  };
};

module.exports.VUE_DEPS_UNAVAILABLE = VUE_DEPS_UNAVAILABLE;
