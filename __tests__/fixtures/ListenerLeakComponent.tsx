import React, { useEffect } from "react";

// A leaking event listener: the effect subscribes a handler to a long-lived
// event target (here a shared event bus; `window`/`document` leak identically)
// and never removes it. The target keeps the handler alive, and the handler
// closes over this component — so the instance is retained for as long as the
// target lives, even after React unmounts the component.
//
// The bus is test-owned (see leak-harness.ts): seeded before each test, dropped
// after, so the leak can't bleed across tests.
export function ListenerLeakComponent(): React.ReactElement {
  useEffect(() => {
    const bus = (
      globalThis as typeof globalThis & { __HEAP_EVENT_TARGET__?: EventTarget }
    ).__HEAP_EVENT_TARGET__;

    bus?.addEventListener("ping", () => {
      // Retained by the bus; captures this component's marker.
    });

    // ❌ THE LEAK: no cleanup. The correct code keeps a handle to the handler and
    //     return () => bus.removeEventListener("ping", handler);
  }, []);

  return <div>listener leak</div>;
}
