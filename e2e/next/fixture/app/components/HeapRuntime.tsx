"use client";
// README fallback for App Router apps on Next < 15.3 (no instrumentation-client).
if (process.env.NODE_ENV === "development") import("react-memory-leak-detector/runtime");

export default function HeapRuntime() {
  return null;
}
