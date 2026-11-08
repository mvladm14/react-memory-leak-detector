"use client";
import { useState } from "react";
import LeakyTimer from "./LeakyTimer";
import FixedTimer from "./FixedTimer";
import { Label } from "./Label";

export default function Toggle() {
  const [leaky, setLeaky] = useState(false);
  const [fixed, setFixed] = useState(false);
  const [label, setLabel] = useState(false);
  return (
    <div>
      <button data-testid="toggle-leaky" onClick={() => setLeaky((v) => !v)}>
        toggle leaky
      </button>
      <button data-testid="toggle-fixed" onClick={() => setFixed((v) => !v)}>
        toggle fixed
      </button>
      <button data-testid="toggle-label" onClick={() => setLabel((v) => !v)}>
        toggle label
      </button>
      {leaky && <LeakyTimer />}
      {fixed && <FixedTimer />}
      {/* ...and a Client Component here, so it belongs in the browser bundle. */}
      <Label text="from-client" />
      {label && <Label text="mounted-later" />}
    </div>
  );
}
