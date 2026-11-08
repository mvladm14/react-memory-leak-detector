import { useState } from "react";
import LeakyTimer from "../app/components/LeakyTimer";
import FixedTimer from "../app/components/FixedTimer";

// Pages Router route. No "use client" anywhere: every component here is a
// client component, so it must be instrumented even without the directive.
export default function Legacy() {
  const [leaky, setLeaky] = useState(false);
  const [fixed, setFixed] = useState(false);
  return (
    <main>
      <button data-testid="toggle-leaky" onClick={() => setLeaky((v) => !v)}>
        toggle leaky
      </button>
      <button data-testid="toggle-fixed" onClick={() => setFixed((v) => !v)}>
        toggle fixed
      </button>
      {leaky && <LeakyTimer />}
      {fixed && <FixedTimer />}
    </main>
  );
}
