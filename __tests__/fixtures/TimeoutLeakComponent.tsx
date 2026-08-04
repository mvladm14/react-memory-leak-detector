import React, { useEffect } from "react";

// A leaking setTimeout: a long-pending timeout that is never cleared. While the
// timeout sits in the timer queue its callback is retained, and the callback
// closes over this component — so the instance can't be collected until the
// timeout fires (here, ~16 minutes away, i.e. effectively never during a
// session). React unmounting the component does not clear the timeout.
export function TimeoutLeakComponent(): React.ReactElement {
  useEffect(() => {
    const id = setTimeout(() => {
      // Retained while the timeout is pending; captures this component's marker.
    }, 1_000_000);

    // ❌ THE LEAK: no cleanup. The correct code would be:
    //     return () => clearTimeout(id);
    void id;
  }, []);

  return <div>timeout leak</div>;
}
