<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

// FixedPromise — aborts/rejects the promise and removes it from the global set
// on unmount, so nothing retains the reaction callback or the marker.
interface InflightPromiseEntry {
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
}
declare global {
  interface Window {
    __E2E_INFLIGHT_PROMISES__?: Set<InflightPromiseEntry>;
  }
}

const data = ref("pending...");
const controller = new AbortController();

onMounted(() => {
  if (!window.__E2E_INFLIGHT_PROMISES__) {
    window.__E2E_INFLIGHT_PROMISES__ = new Set();
  }
  const entry: InflightPromiseEntry = { resolve: () => {}, reject: () => {} };
  const promise = new Promise<string>((resolve, reject) => {
    entry.resolve = resolve;
    entry.reject = reject;
    window.__E2E_INFLIGHT_PROMISES__!.add(entry);
    controller.signal.addEventListener(
      "abort",
      () => {
        window.__E2E_INFLIGHT_PROMISES__!.delete(entry);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
  promise
    .then((val) => {
      data.value = val;
    })
    .catch(() => {
      // Swallow abort rejection.
    });
});

onUnmounted(() => {
  controller.abort();
});
</script>

<template>
  <div data-testid="fixed-promise">FixedPromise: {{ data }}</div>
</template>
