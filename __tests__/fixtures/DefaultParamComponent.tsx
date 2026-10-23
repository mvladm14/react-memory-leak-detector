import React from "react";

// Regression fixture for default-parameter closures (audit issue #2).
//
// Both the hook and the component declare a closure as a DEFAULT PARAMETER
// VALUE. When a function has parameter expressions, its body `var` bindings
// (where the plugin declares `_heap_`) live in a separate environment that
// those closures cannot see. The plugin used to inject `_heap_ && 0;` into
// them anyway, so invoking the default threw
// `ReferenceError: _heap_ is not defined`. The gc jest project compiles this
// file with the real plugin and keeps default params (preset-env targets the
// current Node), so it reproduces the crash exactly.
export function useGreeting(
  format: (name: string) => string = (name) => `hi ${name}`,
): string {
  return format("x");
}

export function DefaultParamComponent({
  label = "go",
  onSelect = () => {},
}: {
  label?: string;
  onSelect?: (label: string) => void;
}): React.ReactElement {
  const greeting = useGreeting();
  return (
    <button data-testid="default-param" onClick={() => onSelect(label)}>
      {greeting}
    </button>
  );
}
