import { defineConfig, devices } from "@playwright/test";

// Config for the Next.js spec. Unlike the Vite config there is no `webServer`:
// run.mjs starts `next dev` itself so it can capture the server log and fail on
// server-side errors, then points this config at it via BASE_URL.
const BASE_URL = process.env.BASE_URL || "http://localhost:3100";

export default defineConfig({
  testDir: "./playwright",
  // GC is non-deterministic even when forced; give each spec room to poll.
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  outputDir: "./test-results",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    launchOptions: {
      // Optional: a locally installed Chromium, for machines that can't
      // download Playwright's browser. CI uses the Docker image's browser.
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        // Expose window.gc so the runtime's forceGc() collects deterministically.
        "--js-flags=--expose-gc",
        // Chromium refuses to run as root (the container default) without this.
        "--no-sandbox",
        // Containers ship a tiny /dev/shm; without this Chromium can crash.
        "--disable-dev-shm-usage",
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
