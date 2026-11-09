import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

// How the fixture mounts its app, React 18+ (createRoot). On React 17, which
// has no `react-dom/client`, vite.config.mjs resolves `./mount` to
// ./mount-legacy.tsx instead; both files export the same two functions.

const container = () => document.getElementById("root")!;

/** Mounts the app. */
export function mount(node: ReactElement): void {
  createRoot(container()).render(node);
}

/** Mounts the app and commits synchronously, before this function returns. */
export function mountSync(node: ReactElement): void {
  flushSync(() => {
    createRoot(container()).render(node);
  });
}
