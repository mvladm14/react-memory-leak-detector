import React from "react";

// A well-behaved component: it opens no closure that outlives its lifecycle.
// Once React unmounts it and a GC pass runs, the babel-injected $Heap marker
// becomes unreachable and is collected, so the tracker stops reporting it.
//
// The heap plugin still instruments this file (marker + track() + a synthetic
// mount/unmount useEffect), which is exactly what we want to exercise: the
// happy path where a component is correctly released.
export function CleanComponent(): React.ReactElement {
  return <div>clean</div>;
}
