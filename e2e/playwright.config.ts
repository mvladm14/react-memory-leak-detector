import { defineConfig, devices } from "@playwright/test";

// The fixture dev server port. strictPort in the fixture config makes a clash
// fail loudly rather than silently drifting to another port.
const PORT = Number(process.env.PORT) || 5173;

export default defineConfig({
  testDir: "./playwright",
  // GC is non-deterministic even when forced; give each spec room to poll.
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        // Expose window.gc so the runtime's forceGc() can collect
        // deterministically — without it the verdict depends on incidental GC.
        "--js-flags=--expose-gc",
        // Chromium refuses to run as root (the default user in the container)
        // without this; harmless when run natively as a normal user.
        "--no-sandbox",
        // Containers ship a tiny /dev/shm; without this Chromium can crash.
        "--disable-dev-shm-usage",
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Boot the fixture's Vite dev server. PLUGIN_REACT / HEAP_ENGINE are already
    // in the environment (set by run.mjs per combo) and inherited here.
    command: `npm --prefix fixture run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
