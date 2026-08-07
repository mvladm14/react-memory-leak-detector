# E2E harness image: Node 22 (>=22.12, required by oxc-parser + Vite 8) with
# Playwright's Chromium and its OS libraries baked in. The repo itself is
# bind-mounted at run time (see docker-compose.yml) rather than copied, so this
# image only needs the browser + system deps — it never goes stale on source.
FROM node:22-bookworm

# Keep in sync with e2e/package.json's @playwright/test. run.mjs also runs
# `playwright install chromium` at start, so a minor drift self-heals (it just
# downloads the matching browser) — this only pre-warms the cache.
ENV PLAYWRIGHT_VERSION=1.62.1
RUN npx --yes playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium

WORKDIR /work
# Default: install root deps (for build+pack) then run the full matrix. Override
# in compose/CLI to run a subset, e.g. `node e2e/run.mjs v6:oxc`.
CMD ["sh", "-c", "npm ci && node e2e/run.mjs"]
