import React, { useEffect, useState } from "react";

/**
 * The correctly-cleaned-up twin of LeakyTimer. Its effect clears the interval
 * on unmount, so nothing keeps the callback (or the injected `_heap_` marker)
 * alive afterward — GC reclaims it and the detector must stay silent. This is
 * the false-positive guard: if the detector flagged this, it'd be useless.
 */
export function FixedTimer() {
  const [n, setN] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setN((x) => x + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return <div data-testid="fixed">FixedTimer #{n}</div>;
}
