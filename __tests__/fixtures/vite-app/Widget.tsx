import React from "react";

// A component whose only nested closure is a `function` declaration — so the
// real-Vite integration test also exercises the FunctionDeclaration capture
// end-to-end, not just in the unit transform tests. `widget-marker-probe` is a
// unique string used to prove the component is really present in build output.
export function Widget() {
  function handleClick() {
    console.log("widget-marker-probe");
  }
  return <button onClick={handleClick}>Widget</button>;
}
