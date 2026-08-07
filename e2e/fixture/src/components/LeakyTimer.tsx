import React, { useEffect, useState } from "react";

/**
 * Leaks on purpose: a `setInterval` whose effect returns NO cleanup. After the
 * component unmounts the timer keeps firing, so the browser's timer registry (a
 * GC root) keeps the callback — and the injected `_heap_` marker it captures —
 * reachable forever. That's exactly what the detector should flag.
 */
export function LeakyTimer() {
  const [n, setN] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      // References state so the closure is non-trivial; the injected
      // `_heap_ && 0` capture rides along and pins the marker after unmount.
      setN((x) => x + 1);
    }, 1000);
    // Deliberately NO `return () => clearInterval(id)` — this is the leak.
    void id;
  }, []);

  return <div data-testid="leaky">LeakyTimer #{n}</div>;
}
