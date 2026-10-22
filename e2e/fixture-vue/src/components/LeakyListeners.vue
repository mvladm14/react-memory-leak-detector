<script setup lang="ts">
import { ref, onMounted } from "vue";

// LeakyListeners — adds a window listener and never removes it. The handler
// closure captures _heap_ and is retained by the global event target.
const x = ref(0);
const y = ref(0);

onMounted(() => {
  const handleMove = (e: MouseEvent) => {
    x.value = e.clientX;
    y.value = e.clientY;
  };
  window.addEventListener("mousemove", handleMove);
});
</script>

<template>
  <div data-testid="leaky-listeners">LeakyListeners ({{ x }}, {{ y }})</div>
</template>
