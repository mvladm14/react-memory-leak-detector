<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

// FixedListeners — removes the window listener on unmount. handleMove is a
// top-level closure so both hooks can reference the same function reference.
const x = ref(0);
const y = ref(0);

const handleMove = (e: MouseEvent) => {
  x.value = e.clientX;
  y.value = e.clientY;
};

onMounted(() => {
  window.addEventListener("mousemove", handleMove);
});

onUnmounted(() => {
  window.removeEventListener("mousemove", handleMove);
});
</script>

<template>
  <div data-testid="fixed-listeners">FixedListeners ({{ x }}, {{ y }})</div>
</template>
