<script setup lang="ts">
import { ref } from "vue";
import LeakyTimer from "./components/LeakyTimer.vue";
import FixedTimer from "./components/FixedTimer.vue";
import LeakyAnimationFrame from "./components/LeakyAnimationFrame.vue";
import FixedAnimationFrame from "./components/FixedAnimationFrame.vue";
import LeakyListeners from "./components/LeakyListeners.vue";
import FixedListeners from "./components/FixedListeners.vue";
import LeakyPromise from "./components/LeakyPromise.vue";
import FixedPromise from "./components/FixedPromise.vue";

// The e2e control surface. Playwright toggles mount/unmount (same data-testids
// as the React fixture) and runs GC to check leak detection. Reuses leak.spec.ts.
const leaky = ref(false);
const fixed = ref(false);
const leakyRaf = ref(false);
const fixedRaf = ref(false);
const leakyListeners = ref(false);
const fixedListeners = ref(false);
const leakyPromise = ref(false);
const fixedPromise = ref(false);
</script>

<template>
  <div>
    <h1>@memleak/vue — Vue e2e fixture</h1>
    <div>
      <button data-testid="toggle-leaky" @click="leaky = !leaky">
        {{ leaky ? "Unmount" : "Mount" }} LeakyTimer
      </button>
      <button data-testid="toggle-fixed" @click="fixed = !fixed">
        {{ fixed ? "Unmount" : "Mount" }} FixedTimer
      </button>
    </div>

    <div>
      <button data-testid="toggle-leaky-raf" @click="leakyRaf = !leakyRaf">
        {{ leakyRaf ? "Unmount" : "Mount" }} LeakyAnimationFrame
      </button>
      <button data-testid="toggle-fixed-raf" @click="fixedRaf = !fixedRaf">
        {{ fixedRaf ? "Unmount" : "Mount" }} FixedAnimationFrame
      </button>
    </div>

    <div>
      <button
        data-testid="toggle-leaky-listeners"
        @click="leakyListeners = !leakyListeners"
      >
        {{ leakyListeners ? "Unmount" : "Mount" }} LeakyListeners
      </button>
      <button
        data-testid="toggle-fixed-listeners"
        @click="fixedListeners = !fixedListeners"
      >
        {{ fixedListeners ? "Unmount" : "Mount" }} FixedListeners
      </button>
    </div>

    <div>
      <button
        data-testid="toggle-leaky-promise"
        @click="leakyPromise = !leakyPromise"
      >
        {{ leakyPromise ? "Unmount" : "Mount" }} LeakyPromise
      </button>
      <button
        data-testid="toggle-fixed-promise"
        @click="fixedPromise = !fixedPromise"
      >
        {{ fixedPromise ? "Unmount" : "Mount" }} FixedPromise
      </button>
    </div>

    <div data-testid="stage">
      <LeakyTimer v-if="leaky" />
      <FixedTimer v-if="fixed" />
      <LeakyAnimationFrame v-if="leakyRaf" />
      <FixedAnimationFrame v-if="fixedRaf" />
      <LeakyListeners v-if="leakyListeners" />
      <FixedListeners v-if="fixedListeners" />
      <LeakyPromise v-if="leakyPromise" />
      <FixedPromise v-if="fixedPromise" />
    </div>
  </div>
</template>
