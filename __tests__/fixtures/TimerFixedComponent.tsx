import React, { useEffect, useRef } from "react";

// The fixed counterpart to TimerLeakComponent: same setInterval, but the effect
// returns a cleanup that clears it on unmount. Because nothing outlives the
// component, React tearing down the fiber makes the instance unreachable and GC
// reclaims it — the tracker never flags it. This is the "cured" version, and it
// guards against false positives on correct code.
export function TimerFixedComponent(): React.ReactElement {
  const ticksRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      ticksRef.current += 1;
    }, 1000);

    // ✅ THE FIX: stop the timer on unmount, so the callback (and this whole
    // component) can be garbage-collected.
    return () => clearInterval(id);
  }, []);

  return <div>tick</div>;
}
