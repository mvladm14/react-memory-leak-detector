"use client";
import { useEffect, useState } from "react";

// The false-positive guard: same shape as LeakyTimer, but cleans up.
export default function FixedTimer() {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTicks((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <p data-testid="fixed">fixed {ticks}</p>;
}
