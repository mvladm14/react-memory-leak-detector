import React, { useEffect } from "react";

import type { InflightEntry } from "../leak-harness";

// The fixed counterpart to PromiseLeakComponent, using the AbortController
// pattern (as you would with `fetch(url, { signal })`): on unmount the request
// is aborted, which REJECTS the promise. Settling it releases the registered
// reaction, so the captured component can be garbage-collected. This is what
// actually frees memory — a bare `cancelled` flag would not.
export function PromiseFixedComponent(): React.ReactElement {
  useEffect(() => {
    const inflight = (
      globalThis as typeof globalThis & {
        __HEAP_INFLIGHT__?: Set<InflightEntry>;
      }
    ).__HEAP_INFLIGHT__;

    const controller = new AbortController();
    const entry: InflightEntry = {};
    const request = new Promise<void>((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
      inflight?.add(entry);
      controller.signal.addEventListener(
        "abort",
        () => {
          inflight?.delete(entry);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });

    request
      .then(() => {
        // ...
      })
      .catch(() => {
        // Swallow the abort rejection.
      });

    // ✅ THE FIX: abort the in-flight request on unmount so the promise settles.
    return () => controller.abort();
  }, []);

  return <div>promise fixed</div>;
}
