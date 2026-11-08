import withHeapMarkers from "react-memory-leak-detector/next";

import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The fixture lives inside the detector's repo, next to other lockfiles, so
  // Turbopack would infer the repo root as its workspace root. Pin it to the
  // fixture (Next 15.5+ only; run.mjs sets the flag). This also checks that
  // withHeapMarkers() merges into an existing `turbopack` block.
  ...(process.env.HEAP_TURBOPACK_ROOT
    ? { turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) } }
    : {}),
};

// Deterministic e2e config, forwarded to the runtime by the injected code (this
// also proves option forwarding works): judge leaks immediately, never debounce,
// and sweep only when the spec forces it (via forceGc), so GC timing can't race
// an automatic sweep.
export default withHeapMarkers(nextConfig, {
  leakAgeMs: 0,
  warnCooldownMs: 0,
  sweepIntervalMs: 3_600_000,
});
