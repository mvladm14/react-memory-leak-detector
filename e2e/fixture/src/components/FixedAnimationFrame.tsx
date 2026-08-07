import { useEffect, useState } from "react";

/**
 * Fixed animation frame component. Cancels the requestAnimationFrame on unmount,
 * releasing the scheduler's reference to the loop callback.
 */
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
