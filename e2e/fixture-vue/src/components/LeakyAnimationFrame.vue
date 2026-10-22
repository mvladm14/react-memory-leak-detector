<script setup lang="ts">
import { ref, onMounted } from "vue";

// LeakyAnimationFrame — a self-rescheduling rAF loop with no cancellation. The
// loop closure captures _heap_ and is retained by the animation-frame queue.
const frames = ref(0);

onMounted(() => {
  const loop = () => {
    frames.value++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
</script>

<template>
  <div data-testid="leaky-raf">LeakyAnimationFrame #{{ frames }}</div>
</template>
