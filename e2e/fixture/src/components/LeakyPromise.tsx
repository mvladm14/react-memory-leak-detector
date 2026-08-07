import { useEffect, useState } from "react";

interface InflightPromiseEntry {
  resolve: (value: string) => void;
}

declare global {
  interface Window {
    __E2E_INFLIGHT_PROMISES__?: Set<InflightPromiseEntry>;
  }
}

/**
 * Leaks on purpose: Starts a promise that does not settle, and keeps the resolve
 * function callback held in a global Set. Since the resolve callback is globally
 * referenced and never called, the Promise reactions (.then callbacks) remain
 * active and keep the component closure and its `_heap_` marker from being GC'd.
 */
export function LeakyPromise() {
  const [data, setData] = useState("pending...");

  useEffect(() => {
    if (!window.__E2E_INFLIGHT_PROMISES__) {
      window.__E2E_INFLIGHT_PROMISES__ = new Set();
    }

    const entry: InflightPromiseEntry = { resolve: () => {} };
    const promise = new Promise<string>((resolve) => {
      entry.resolve = resolve;
      window.__E2E_INFLIGHT_PROMISES__!.add(entry);
    });

    promise.then((val) => {
      setData(val);
    });

    // Deliberately NO cleanup to remove/resolve the promise on unmount
  }, []);

  return <div data-testid="leaky-promise">LeakyPromise: {data}</div>;
}
