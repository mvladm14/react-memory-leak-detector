import { useEffect, useState } from "react";

/** LeakyAnimationFrame - requestAnimationFrame loop leak with no cleanup. */
export function LeakyAnimationFrame() {
  const [frames, setFrames] = useState(0);

  useEffect(() => {
    const loop = () => {
      // Holds onto the setFrames dispatcher and component closure
      setFrames((f) => f + 1);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // Deliberately NO cleanup to cancel the animation frame
  }, []);

  return <div data-testid="leaky-raf">LeakyAnimationFrame #{frames}</div>;
}
