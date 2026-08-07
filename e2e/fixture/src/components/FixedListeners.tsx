import { useEffect, useState } from "react";

/** FixedListeners - removes mousemove event listener on unmount. */
export function FixedListeners() {
  const [coords, setCoords] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      setCoords({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener("mousemove", handleMove);

    return () => {
      window.removeEventListener("mousemove", handleMove);
    };
  }, []);

  return (
    <div data-testid="fixed-listeners">
      FixedListeners ({coords.x}, {coords.y})
    </div>
  );
}
