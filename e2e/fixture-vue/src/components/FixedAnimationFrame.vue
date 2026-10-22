<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

// FixedAnimationFrame — cancels the pending frame on unmount, releasing the loop.
const frames = ref(0);
let id = 0;

onMounted(() => {
  const loop = () => {
    frames.value++;
    id = requestAnimationFrame(loop);
  };
  id = requestAnimationFrame(loop);
});

onUnmounted(() => {
  cancelAnimationFrame(id);
});
</script>

<template>
  <div data-testid="fixed-raf">FixedAnimationFrame #{{ frames }}</div>
</template>
