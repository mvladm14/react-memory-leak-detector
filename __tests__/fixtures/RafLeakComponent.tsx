import React, { useEffect } from "react";

// A leaking requestAnimationFrame loop: the effect kicks off a self-rescheduling
// animation loop and never cancels it. Each frame schedules the next, so there
// is always a pending frame holding `loop`, which closes over this component —
// pinning the instance in memory (and burning a frame every ~16ms) forever,
// even after React unmounts it.
export function RafLeakComponent(): React.ReactElement {
  useEffect(() => {
    const loop = () => {
      // Reschedules itself; the pending frame retains this component's marker.
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    // ❌ THE LEAK: no cleanup. The correct code would cancel the pending frame:
    //     return () => cancelAnimationFrame(raf);
  }, []);

  return <div>raf leak</div>;
}
