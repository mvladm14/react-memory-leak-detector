import { useEffect, useState } from "react";

/**
 * Leaks on purpose: attaches a `mousemove` event listener on `window` (a global GC root)
 * but never removes it. The window retains the event callback, which retains the component
 * instance and the `_heap_` marker closure.
 */
export function LeakyListeners() {
  const [coords, setCoords] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      setCoords({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener("mousemove", handleMove);
    // Deliberately NO `return () => window.removeEventListener("mousemove", handleMove)`
  }, []);

  return (
    <div data-testid="leaky-listeners">
      LeakyListeners ({coords.x}, {coords.y})
    </div>
  );
}
