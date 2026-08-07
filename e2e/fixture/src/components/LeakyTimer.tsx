import { useEffect, useState } from "react";

/** LeakyTimer - setInterval leak with no cleanup. */
export function LeakyTimer() {
  const [n, setN] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setN((x) => x + 1);
    }, 1000);
    void id;
  }, []);

  return <div data-testid="leaky">LeakyTimer #{n}</div>;
}
