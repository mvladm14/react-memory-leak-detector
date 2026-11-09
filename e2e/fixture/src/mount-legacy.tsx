import type { ReactElement } from "react";
import ReactDOM from "react-dom";

// React 17 twin of ./mount.tsx (legacy root: ReactDOM.render). vite.config.mjs
// resolves `./mount` here when the installed React is 17, because mount.tsx
// imports `react-dom/client`, which React 17 doesn't have, and Vite resolves
// every import of a module it serves.

const container = () => document.getElementById("root")!;

/** Mounts the app. */
export function mount(node: ReactElement): void {
  ReactDOM.render(node, container());
}

/** Mounts the app and commits synchronously: legacy roots render synchronously. */
export function mountSync(node: ReactElement): void {
  ReactDOM.render(node, container());
}
