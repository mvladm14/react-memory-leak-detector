import React, { useEffect, useState } from "react";

/** FixedTimer - properly clears setInterval on unmount. */
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
