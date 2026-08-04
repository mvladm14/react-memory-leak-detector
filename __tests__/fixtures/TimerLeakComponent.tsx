import React, { useEffect, useRef } from "react";

// The classic real-world leak: an effect starts a `setInterval` and never
// clears it. The interval callback closes over component state (`ticksRef`), so
// for as long as the timer is alive the *entire component instance* is retained
// — including everything it captured. React unmounting the component does NOT
// stop the timer, so the instance can never be garbage-collected: one leaked
// component (and one live timer) per mount, for the lifetime of the app.
//
// This is deliberately buggy code, written exactly the way it slips into real
// components. The fix is a single line — see the note below.
export function TimerLeakComponent(): React.ReactElement {
  const ticksRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      // Touches component-scoped state, so the timer retains this instance.
      ticksRef.current += 1;
    }, 1000);

    // ❌ THE LEAK: there is no cleanup. The correct code would be:
    //     return () => clearInterval(id);
    // Without it, `id`'s callback (and this whole component) lives forever.
    void id;
  }, []);

  return <div>tick</div>;
}
