import { useState } from "react";
import { FixedAnimationFrame } from "./components/FixedAnimationFrame";
import { FixedListeners } from "./components/FixedListeners";
import { FixedPromise } from "./components/FixedPromise";
import { FixedTimer } from "./components/FixedTimer";
import { LeakyAnimationFrame } from "./components/LeakyAnimationFrame";
import { LeakyListeners } from "./components/LeakyListeners";
import { LeakyPromise } from "./components/LeakyPromise";
import { LeakyTimer } from "./components/LeakyTimer";

/**
 * The e2e control surface. Each toggle mounts/unmounts one child; the Playwright
 * spec clicks a toggle twice (mount → unmount) and then forces GC to see whether
 * the detector flags the leftover. Buttons carry `data-testid`s for stable
 * selectors.
 */
export function App() {
  const [leaky, setLeaky] = useState(false);
  const [fixed, setFixed] = useState(false);
  const [leakyRaf, setLeakyRaf] = useState(false);
  const [fixedRaf, setFixedRaf] = useState(false);
  const [leakyListeners, setLeakyListeners] = useState(false);
  const [fixedListeners, setFixedListeners] = useState(false);
  const [leakyPromise, setLeakyPromise] = useState(false);
  const [fixedPromise, setFixedPromise] = useState(false);

  return (
    <div>
      <h1>react-memory-leak-detector — e2e fixture</h1>
      <div>
        <button data-testid="toggle-leaky" onClick={() => setLeaky((v) => !v)}>
          {leaky ? "Unmount" : "Mount"} LeakyTimer
        </button>
        <button data-testid="toggle-fixed" onClick={() => setFixed((v) => !v)}>
          {fixed ? "Unmount" : "Mount"} FixedTimer
        </button>
      </div>

      <div>
        <button
          data-testid="toggle-leaky-raf"
          onClick={() => setLeakyRaf((v) => !v)}
        >
          {leakyRaf ? "Unmount" : "Mount"} LeakyAnimationFrame
        </button>
        <button
          data-testid="toggle-fixed-raf"
          onClick={() => setFixedRaf((v) => !v)}
        >
          {fixedRaf ? "Unmount" : "Mount"} FixedAnimationFrame
        </button>
      </div>

      <div>
        <button
          data-testid="toggle-leaky-listeners"
          onClick={() => setLeakyListeners((v) => !v)}
        >
          {leakyListeners ? "Unmount" : "Mount"} LeakyListeners
        </button>
        <button
          data-testid="toggle-fixed-listeners"
          onClick={() => setFixedListeners((v) => !v)}
        >
          {fixedListeners ? "Unmount" : "Mount"} FixedListeners
        </button>
      </div>

      <div>
        <button
          data-testid="toggle-leaky-promise"
          onClick={() => setLeakyPromise((v) => !v)}
        >
          {leakyPromise ? "Unmount" : "Mount"} LeakyPromise
        </button>
        <button
          data-testid="toggle-fixed-promise"
          onClick={() => setFixedPromise((v) => !v)}
        >
          {fixedPromise ? "Unmount" : "Mount"} FixedPromise
        </button>
      </div>

      <div data-testid="stage">
        {leaky && <LeakyTimer />}
        {fixed && <FixedTimer />}
        {leakyRaf && <LeakyAnimationFrame />}
        {fixedRaf && <FixedAnimationFrame />}
        {leakyListeners && <LeakyListeners />}
        {fixedListeners && <FixedListeners />}
        {leakyPromise && <LeakyPromise />}
        {fixedPromise && <FixedPromise />}
      </div>
    </div>
  );
}
