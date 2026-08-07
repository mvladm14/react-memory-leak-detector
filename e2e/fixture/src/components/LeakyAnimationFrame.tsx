import { useEffect, useState } from "react";

/**
 * Leaks on purpose: a `requestAnimationFrame` loop whose effect returns NO cleanup.
 * On unmount, the pending frame resolves and starts another frame, holding onto
 * the component (and its injected `_heap_` marker) forever in the browser runtime's
 * animation callbacks registry.
 */
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
