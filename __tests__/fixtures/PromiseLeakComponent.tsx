import React, { useEffect } from "react";

import type { InflightEntry } from "../leak-harness";

// A leaking promise: the effect starts a request (modelled as a promise kept
// reachable by an in-flight registry, the way a real fetch keeps its promise
// alive) and chains a `.then` that closes over this component. Because the
// request is never aborted, the promise stays pending, its reaction is never
// released, and the component is retained after unmount.
//
// NOTE: a `cancelled`/`isMounted` flag does NOT fix this — the reaction is still
// registered on the pending promise and still captures the component. The only
// real fix is to make the promise SETTLE on unmount (see PromiseFixedComponent).
export function PromiseLeakComponent(): React.ReactElement {
  useEffect(() => {
    const inflight = (
      globalThis as typeof globalThis & {
        __HEAP_INFLIGHT__?: Set<InflightEntry>;
      }
    ).__HEAP_INFLIGHT__;

    new Promise<void>((resolve, reject) => {
      inflight?.add({ resolve, reject });
    }).then(() => {
      // The reaction on a never-settling request captures this component.
    });

    // ❌ THE LEAK: no AbortController, no cleanup — the request never settles.
  }, []);

  return <div>promise leak</div>;
}
