import React, { useState } from "react";
import { LeakyTimer } from "./components/LeakyTimer";
import { FixedTimer } from "./components/FixedTimer";

/**
 * The e2e control surface. Each toggle mounts/unmounts one child; the Playwright
 * spec clicks a toggle twice (mount → unmount) and then forces GC to see whether
 * the detector flags the leftover. Buttons carry `data-testid`s for stable
 * selectors.
 */
export function App() {
  const [leaky, setLeaky] = useState(false);
  const [fixed, setFixed] = useState(false);

  return (
    <div>
      <h1>react-memory-leak-detector — e2e fixture</h1>
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
