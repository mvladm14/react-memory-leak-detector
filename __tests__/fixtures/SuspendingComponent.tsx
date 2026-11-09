import React from "react";

// Suspends (throws a pending promise) until its gate is opened, then renders.
// Used to put sibling content into a Suspense fallback and to render a
// component that never commits. Throwing the promise works on React 17–19
// (React 19's `use()` is not available on 18).
export type Gate = { promise: Promise<void>; open: boolean; release: () => void };

export function makeGate(): Gate {
  let release!: () => void;
  const gate = { open: false } as Gate;
  gate.promise = new Promise<void>((resolve) => {
    release = resolve;
  }).then(() => {
    gate.open = true;
  });
  gate.release = release;
  return gate;
}

export function SuspendingComponent({ gate }: { gate: Gate }): React.ReactElement {
  if (!gate.open) throw gate.promise;
  return <div>ready</div>;
}
