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

/**
 * Fixed twin of LeakyPromise. On unmount, it rejects the promise and removes the
 * resolve/reject references from the global list, allowing everything to be garbage collected.
 */
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
