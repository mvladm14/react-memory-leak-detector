import React, { useEffect } from "react";

// The fixed counterpart to TimeoutLeakComponent: the effect returns a cleanup
// that clears the pending timeout on unmount, so its callback is released and
// the component can be garbage-collected.
export function TimeoutFixedComponent(): React.ReactElement {
  useEffect(() => {
    const id = setTimeout(() => {
      // ...
    }, 1_000_000);

    // ✅ THE FIX: clear the pending timeout on unmount.
    return () => clearTimeout(id);
  }, []);

  return <div>timeout fixed</div>;
}
