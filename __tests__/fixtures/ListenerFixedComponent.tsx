import React, { useEffect } from "react";

// The fixed counterpart to ListenerLeakComponent: it keeps a reference to the
// handler and removes it on unmount, so the event target no longer retains it
// and the component can be garbage-collected.
export function ListenerFixedComponent(): React.ReactElement {
  useEffect(() => {
    const bus = (
      globalThis as typeof globalThis & { __HEAP_EVENT_TARGET__?: EventTarget }
    ).__HEAP_EVENT_TARGET__;

    const handler = () => {
      // ...
    };
    bus?.addEventListener("ping", handler);

    // ✅ THE FIX: remove the same handler on unmount.
    return () => bus?.removeEventListener("ping", handler);
  }, []);

  return <div>listener fixed</div>;
}
