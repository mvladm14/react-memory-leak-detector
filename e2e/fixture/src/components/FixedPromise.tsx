import { useEffect, useState } from "react";

interface InflightPromiseEntry {
  resolve: (value: string) => void;
  reject: (reason?: any) => void;
}

declare global {
  interface Window {
    __E2E_INFLIGHT_PROMISES__?: Set<InflightPromiseEntry>;
  }
}

/** FixedPromise - aborts/rejects promise and cleans up global lists on unmount. */
export function FixedPromise() {
  const [data, setData] = useState("pending...");

  useEffect(() => {
    if (!window.__E2E_INFLIGHT_PROMISES__) {
      window.__E2E_INFLIGHT_PROMISES__ = new Set();
    }

    const controller = new AbortController();
    const entry: InflightPromiseEntry = { resolve: () => {}, reject: () => {} };

    const promise = new Promise<string>((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
      window.__E2E_INFLIGHT_PROMISES__!.add(entry);

      controller.signal.addEventListener(
        "abort",
        () => {
          window.__E2E_INFLIGHT_PROMISES__!.delete(entry);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });

    promise
      .then((val) => {
        setData(val);
      })
      .catch(() => {
        // Swallow abort rejection
      });

    return () => {
      controller.abort();
    };
  }, []);

  return <div data-testid="fixed-promise">FixedPromise: {data}</div>;
}
