// Runtime regression for audit issue #2: default-parameter callbacks.
//
// Runs in the "gc" jest project so the fixture is compiled by the REAL babel
// plugin (babel-jest, preset-env targeting the current Node — default params
// are kept, not moved into the body). Before the fix, rendering threw
// `ReferenceError: _heap_ is not defined` from the hook's default formatter,
// and clicking threw the same from the default `onSelect`.

import React from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";

// Installs `window.__heapTracker`, which the injected fixture code calls into.
import "../src/runtime";

import { DefaultParamComponent } from "./fixtures/DefaultParamComponent";

const tracker = () => window.__heapTracker!;

afterEach(() => {
  cleanup();
});

describe("default-parameter closures at runtime", () => {
  it("renders and invokes default callbacks without ReferenceError", () => {
    const { getByTestId } = render(React.createElement(DefaultParamComponent));

    // The hook's default formatter ran during render.
    const button = getByTestId("default-param");
    expect(button.textContent).toBe("hi x");

    // The component's default onSelect runs on click.
    expect(() => fireEvent.click(button)).not.toThrow();
  });

  it("still instruments the component", () => {
    // Skipping param closures must not cost us the marker: while mounted the
    // tracker lists the component as live.
    render(React.createElement(DefaultParamComponent));
    const row = tracker()
      .report()
      .find((r) => r.component === "DefaultParamComponent");
    expect(row).toBeDefined();
    expect(row!.live).toBeGreaterThanOrEqual(1);
  });
});
