import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import heapMarkers from "@memleak/vue";

// The Vue leg has no engine matrix — the Vue plugin rides Oxc + @vue/compiler-sfc
// only. heapMarkers() runs at enforce:"pre" and @vitejs/plugin-vue's main
// transform does not, so heapMarkers always sees the raw SFC first regardless of
// array order; listing it before vue() keeps the intent obvious.
export default defineConfig({
  plugins: [heapMarkers(), vue()],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
});
