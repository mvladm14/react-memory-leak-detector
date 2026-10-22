const heapMarkersVue = require("@memleak/vue");
const { oxcAvailable } = require("./oxc-available");

// The Vue engine rides oxc-parser (+ @vue/compiler-sfc), so it can't run where
// oxc can't load (e.g. the CI Node 18 leg). Gate the same way the Oxc-React
// suites do — skip rather than fail.
const describeVue = oxcAvailable ? describe : describe.skip;

// The Vite `transform` hook never references `this`; both are async.
function transform(plugin, code, id) {
  return plugin.transform(code, id);
}

const SFC = `<template>
  <button @click="onClick">{{ n }}</button>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
const n = ref(0);
function onClick() { n.value++; }
onMounted(() => { setInterval(() => n.value++, 1000); });
</script>

<style scoped>
button { color: red; }
</style>
`;

describeVue("Vue engine — <script setup> SFCs", () => {
  const vue = (opts) => heapMarkersVue({ silent: true, ...opts });

  it("injects a filename-derived marker + track() + lifecycle", async () => {
    const result = await transform(vue(), SFC, "/app/src/Counter.vue");
    expect(result).not.toBeNull();
    expect(result.code).toContain("function Counter$Heap()");
    expect(result.code).toContain("const _heap_ = new (function Counter$Heap() {})()");
    expect(result.code).toContain(
      'window.__heapTracker.track(_heap_, "Counter")',
    );
    // Lifecycle: aliased vue import + onMounted/onUnmounted driving the tracker.
    expect(result.code).toContain(
      'import { onMounted as __heap_onMounted, onUnmounted as __heap_onUnmounted } from "vue";',
    );
    expect(result.code).toContain("__heap_onMounted(() => {");
    expect(result.code).toContain("__heap_onUnmounted(() => {");
    expect(result.code).toContain("window.__heapTracker.markMounted(_heap_)");
    expect(result.code).toContain("window.__heapTracker.markUnmounted(_heap_)");
  });

  it("captures every closure defined in the script block", async () => {
    const result = await transform(vue(), SFC, "/app/src/Counter.vue");
    // onClick (declaration), the onMounted arrow, and the setInterval arrow.
    const count = (result.code.match(/_heap_ && 0;/g) || []).length;
    expect(count).toBe(3);
    expect(result.code).toMatch(/function onClick\(\)\s*{\s*_heap_ && 0;/);
  });

  it("leaves <template> and <style> bytes untouched", async () => {
    const result = await transform(vue(), SFC, "/app/src/Counter.vue");
    expect(result.code).toContain('<button @click="onClick">{{ n }}</button>');
    expect(result.code).toContain("button { color: red; }");
    // The original TS is preserved for @vitejs/plugin-vue to compile afterward.
    expect(result.code).toContain("const n = ref(0);");
  });

  it("honors defineOptions({ name }) for the marker name", async () => {
    const sfc = `<script setup>
defineOptions({ name: "Fancy" });
let t;
function start() { t = setInterval(() => {}, 100); }
</script>
<template><div /></template>`;
    const result = await transform(vue(), sfc, "/app/src/whatever.vue");
    expect(result.code).toContain("function Fancy$Heap()");
    expect(result.code).toContain('window.__heapTracker.track(_heap_, "Fancy")');
  });

  it("returns null for the SFC's ?vue sub-requests", async () => {
    const sub = await transform(
      vue(),
      SFC,
      "/app/src/Counter.vue?vue&type=script&setup=true&lang.ts",
    );
    expect(sub).toBeNull();
  });

  it("returns null for a template-only SFC (nothing to instrument)", async () => {
    const tmpl = `<template><div>hi</div></template>`;
    expect(await transform(vue(), tmpl, "/app/src/Plain.vue")).toBeNull();
  });

  it("returns null for a plain <script> (non-setup) SFC this pass", async () => {
    const opts = `<script>
export default { name: "Old" };
</script>
<template><div /></template>`;
    expect(await transform(vue(), opts, "/app/src/Old.vue")).toBeNull();
  });

  it("returns null for non-.vue files", async () => {
    expect(
      await transform(vue(), 'import { ref } from "vue";', "/app/src/util.ts"),
    ).toBeNull();
  });

  it("skips a component matched by excludeNames", async () => {
    const result = await transform(
      vue({ excludeNames: [/^Counter$/] }),
      SFC,
      "/app/src/Counter.vue",
    );
    expect(result).toBeNull();
  });

  it("keeps the marker but drops lifecycle for excludeUnmountTracking", async () => {
    const result = await transform(
      vue({ excludeUnmountTracking: [/^Counter$/] }),
      SFC,
      "/app/src/Counter.vue",
    );
    expect(result).not.toBeNull();
    expect(result.code).toContain("function Counter$Heap()");
    expect(result.code).toContain('window.__heapTracker.track(_heap_, "Counter")');
    // No lifecycle hooks, and therefore no aliased vue import.
    expect(result.code).not.toContain("__heap_onMounted");
    expect(result.code).not.toContain("__heap_onUnmounted");
  });

  it("injects the runtime-config block for non-default options", async () => {
    const result = await transform(
      vue({ leakAgeMs: 5000 }),
      SFC,
      "/app/src/Counter.vue",
    );
    expect(result.code).toContain("__heapTrackerOptions");
    expect(result.code).toContain("leakAgeMs: 5000");
  });

  it("registers lifecycle before top-level await, and after imports", async () => {
    const asyncSfc = `<script setup lang="ts">
import { ref } from "vue";
const n = ref(0);
const data = await fetch("/x").then((r) => r.json());
</script>
<template><div>{{ n }}</div></template>`;
    const result = await transform(vue(), asyncSfc, "/app/src/Async.vue");
    expect(result).not.toBeNull();
    const markerIdx = result.code.indexOf("const _heap_ =");
    const awaitIdx = result.code.indexOf("await fetch");
    const importIdx = result.code.indexOf('import { ref } from "vue";');
    expect(markerIdx).toBeGreaterThan(importIdx);
    expect(markerIdx).toBeLessThan(awaitIdx);
  });

  it("aligns offsets with multibyte script content", async () => {
    const wide = `<template><b>{{ label }}</b></template>
<script setup lang="ts">
const label = "café — 𝟙 unit";
const onClick = () => { console.log(label); };
</script>`;
    const result = await transform(vue(), wide, "/app/src/Wide.vue");
    expect(result).not.toBeNull();
    // Marker landed at a statement boundary, not mid-token: the string is intact.
    expect(result.code).toContain('"café — 𝟙 unit"');
    expect(result.code).toContain("Wide$Heap");
    expect(result.code).toContain("_heap_ && 0;");
  });
});
