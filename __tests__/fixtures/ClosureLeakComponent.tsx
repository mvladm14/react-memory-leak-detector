import React, { useEffect } from "react";

// A closure leak: the effect registers a callback on a long-lived, process-wide
// collection (think `emitter.on(...)`, `store.subscribe(...)`, or
// `window.addEventListener(...)`) and never removes it. The retained callback
// closes over the component instance, so the instance stays reachable for the
// life of the app even after React unmounts it — one leaked closure (and one
// leaked component) per mount.
//
// The heap plugin injects `_heap_ && 0` into the callback, so the leaked closure
// drags this component's $Heap marker into the heap, where the tracker (and a
// heap snapshot searching `ClosureLeakComponent$Heap`) can find it.
//
// The sink stands in for that external collection; the test owns it (seeds it
// before each test, clears it after) so the leak can't bleed across tests.
export function ClosureLeakComponent(): React.ReactElement {
  useEffect(() => {
    const subscribers = (
      globalThis as typeof globalThis & {
        __HEAP_LEAK_SINK__?: Array<() => void>;
      }
    ).__HEAP_LEAK_SINK__;

    // Registering the callback is fine; NEVER removing it is the leak.
    subscribers?.push(() => {
      /* retained subscriber callback — intentionally empty body */
    });

    // ❌ THE LEAK: no cleanup. The correct code would remove the callback, e.g.
    //     return () => { subscribers.splice(subscribers.indexOf(cb), 1); };
  }, []);

  return <div>closure leak</div>;
}
