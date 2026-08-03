// Importing ../src/runtime has side effects: it installs `window.__heapTracker`,
// starts the sweep interval, and logs an install message. These tests verify the
// install is idempotent (a second evaluation — HMR reload, duplicate import —
// must not replace the live tracker or re-log) and that pre-load options apply.

type TestWindow = Window & {
  __heapTracker?: unknown;
  __heapTrackerOptions?: unknown;
};

const testWindow = window as TestWindow;

describe("runtime install", () => {
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers(); // the runtime starts a setInterval sweep loop on load
    infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    delete testWindow.__heapTracker;
    delete testWindow.__heapTrackerOptions;
  });

  afterEach(() => {
    infoSpy.mockRestore();
    jest.clearAllTimers();
    jest.useRealTimers();
    delete testWindow.__heapTracker;
    delete testWindow.__heapTrackerOptions;
  });

  it("installs window.__heapTracker once and logs a single install message", () => {
    jest.isolateModules(() => {
      require("../src/runtime");
    });

    expect(testWindow.__heapTracker).toBeDefined();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(String(infoSpy.mock.calls[0][0])).toContain(
      "[heap-leak] tracker installed",
    );
  });

  it("keeps the original tracker and does not re-log on a second evaluation", () => {
    jest.isolateModules(() => {
      require("../src/runtime");
    });
    const firstApi = testWindow.__heapTracker;

    jest.isolateModules(() => {
      require("../src/runtime");
    });

    expect(testWindow.__heapTracker).toBe(firstApi); // not replaced
    expect(infoSpy).toHaveBeenCalledTimes(1); // installed only once
  });

  it("applies window.__heapTrackerOptions set before load", () => {
    testWindow.__heapTrackerOptions = { logging: false };

    jest.isolateModules(() => {
      require("../src/runtime");
    });

    expect(testWindow.__heapTracker).toBeDefined();
    expect(infoSpy).not.toHaveBeenCalled(); // logging:false suppresses the message
  });
});
