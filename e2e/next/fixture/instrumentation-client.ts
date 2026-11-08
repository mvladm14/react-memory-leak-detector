// README: with Next 15.3+, load the runtime here. It runs in the browser
// before hydration. Next 14 ignores this file; see app/components/HeapRuntime.tsx.
if (process.env.NODE_ENV === "development") import("react-memory-leak-detector/runtime");
