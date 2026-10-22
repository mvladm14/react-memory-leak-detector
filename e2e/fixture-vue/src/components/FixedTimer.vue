<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

// FixedTimer — clears the interval on unmount, so the callback (and the marker
// it captures) is released and gets collected. Must NOT be flagged.
const n = ref(0);
let id: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  id = setInterval(() => {
    n.value++;
  }, 1000);
});

onUnmounted(() => {
  if (id) clearInterval(id);
});
</script>

<template>
  <div data-testid="fixed">FixedTimer #{{ n }}</div>
</template>
