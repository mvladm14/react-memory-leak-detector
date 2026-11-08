"use client";
import { useEffect, useState } from "react";

// Leaks on purpose: the interval is never cleared, so its callback keeps the
// component's closure (and the injected marker) alive after unmount.
export default function LeakyTimer() {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    setInterval(() => setTicks((t) => t + 1), 1000);
  }, []);
  return <p data-testid="leaky">leaky {ticks}</p>;
}
