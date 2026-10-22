<script setup lang="ts">
import { ref, onMounted } from "vue";

// LeakyTimer — setInterval with no cleanup. The interval callback captures the
// injected _heap_ marker, so it outlives unmount and is flagged as a leak.
const n = ref(0);

onMounted(() => {
  setInterval(() => {
    n.value++;
  }, 1000);
});
</script>

<template>
  <div data-testid="leaky">LeakyTimer #{{ n }}</div>
</template>
