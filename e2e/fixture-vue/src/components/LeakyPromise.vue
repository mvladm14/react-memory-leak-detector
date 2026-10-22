<script setup lang="ts">
import { ref, onMounted } from "vue";

// LeakyPromise — a promise that never settles, kept alive via a global set, with
// a reaction callback that captures _heap_. Neither is cleaned up on unmount.
interface InflightPromiseEntry {
  resolve: (value: string) => void;
}
declare global {
  interface Window {
    __E2E_INFLIGHT_PROMISES__?: Set<InflightPromiseEntry>;
  }
}

const data = ref("pending...");

onMounted(() => {
  if (!window.__E2E_INFLIGHT_PROMISES__) {
    window.__E2E_INFLIGHT_PROMISES__ = new Set();
  }
  const entry: InflightPromiseEntry = { resolve: () => {} };
  const promise = new Promise<string>((resolve) => {
    entry.resolve = resolve;
    window.__E2E_INFLIGHT_PROMISES__!.add(entry);
  });
  promise.then((val) => {
    data.value = val;
  });
});
</script>

<template>
  <div data-testid="leaky-promise">LeakyPromise: {{ data }}</div>
</template>
