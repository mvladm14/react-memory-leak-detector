import { useEffect, useState } from "react";

interface InflightPromiseEntry {
  resolve: (value: string) => void;
}

declare global {
  interface Window {
    __E2E_INFLIGHT_PROMISES__?: Set<InflightPromiseEntry>;
  }
}

/** LeakyPromise - pending promise with reaction callback but no cleanup. */
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
