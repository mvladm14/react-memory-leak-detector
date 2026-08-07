import { useEffect, useState } from "react";

/** FixedAnimationFrame - cancels requestAnimationFrame on unmount. */
export function FixedAnimationFrame() {
  const [frames, setFrames] = useState(0);

  useEffect(() => {
    let id: number;
    const loop = () => {
      setFrames((f) => f + 1);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(id);
    };
  }, []);

  return <div data-testid="fixed-raf">FixedAnimationFrame #{frames}</div>;
}
