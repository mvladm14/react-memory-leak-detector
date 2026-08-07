import { useEffect, useState } from "react";

/** LeakyListeners - mousemove event listener leak with no cleanup. */
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
