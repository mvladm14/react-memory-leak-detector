import React, { useEffect } from "react";

// The fixed counterpart to RafLeakComponent: it tracks the latest frame handle
// and cancels it on unmount, so the loop stops rescheduling and the callback
// (and this component) can be garbage-collected.
export function RafFixedComponent(): React.ReactElement {
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // ✅ THE FIX: cancel the pending frame on unmount, ending the loop.
    return () => cancelAnimationFrame(raf);
  }, []);

  return <div>raf fixed</div>;
}
