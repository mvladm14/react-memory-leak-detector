/// <reference types="vite/client" />
import React, { useState } from "react";
import { FixedTimer } from "./components/FixedTimer";
import { LeakyTimer } from "./components/LeakyTimer";
import { mountSync } from "./mount";

// The "late runtime" entry (/late.html). Unlike main.tsx, which imports the
// runtime statically, this entry installs it exactly the way the README does:
// a fire-and-forget dynamic import that resolves only after the first render
// and commit below. Every component in the initial tree therefore calls
// track() while `window.__heapTracker` is still absent — the runtime must
// adopt them on their first mount/unmount it sees, or their leaks are lost.
if (import.meta.env.DEV) import("react-memory-leak-detector/runtime");

/** Mounts a leaky and a fixed component in the INITIAL render; the buttons unmount them. */
function LateApp() {
  const [leaky, setLeaky] = useState(true);
  const [fixed, setFixed] = useState(true);
  return (
    <div>
      <h1>react-memory-leak-detector — e2e fixture (late runtime)</h1>
      <button data-testid="toggle-leaky" onClick={() => setLeaky((v) => !v)}>
        {leaky ? "Unmount" : "Mount"} LeakyTimer
      </button>
      <button data-testid="toggle-fixed" onClick={() => setFixed((v) => !v)}>
        {fixed ? "Unmount" : "Mount"} FixedTimer
      </button>
      <div data-testid="stage">
        {leaky && <LeakyTimer />}
        {fixed && <FixedTimer />}
      </div>
    </div>
  );
}

// mountSync makes the initial render + commit synchronous, so by the next line
// both components have already rendered — deterministically before the dynamic
// import above can resolve (a module fetch never completes synchronously).
mountSync(<LateApp />);
const trackerAtRender = !!window.__heapTracker;

// Test hooks (same shape as main.tsx). The module cache de-duplicates this
// import with the README one above, so this resolves once the runtime is
// installed — the point at which subscribing is possible.
const events: unknown[] = [];
import("react-memory-leak-detector/runtime").then(() => {
  window.__heapTracker?.subscribe((event) => events.push(event));
  window.__leakTest = {
    events,
    trackerAtRender,
    async collect(cycles = 8) {
      for (let i = 0; i < cycles; i++) {
        window.__heapTracker?.forceGc(); // window.gc() (needs --expose-gc) + sweep()
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      return { events: events.slice(), report: window.__heapTracker?.report() ?? [] };
    },
  };
});
