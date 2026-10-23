import { useState } from "react";

/**
 * DefaultCallback - regression for audit issue #2. Both the hook and the
 * component declare a closure as a DEFAULT PARAMETER value. The detector used
 * to inject its `_heap_` capture into those closures, but a function's params
 * can't see its body vars, so invoking the default threw
 * `ReferenceError: _heap_ is not defined` (render crash for the hook, click
 * crash for the prop). Vite dev keeps default params, so this is exactly
 * where the bug surfaced.
 */
function useLabel(format: (n: number) => string = (n) => `clicked ${n}`) {
  const [clicks, setClicks] = useState(0);
  return { label: format(clicks), bump: () => setClicks((c) => c + 1) };
}

export function DefaultCallback({
  onSelect = () => {},
}: {
  onSelect?: (n: number) => void;
}) {
  const { label, bump } = useLabel();
  return (
    <button
      data-testid="default-callback"
      onClick={() => {
        onSelect(1);
        bump();
      }}
    >
      DefaultCallback {label}
    </button>
  );
}
