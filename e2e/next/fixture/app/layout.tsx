import type { ReactNode } from "react";
import localFont from "next/font/local";
import HeapRuntime from "./components/HeapRuntime";

// next/font is SWC-only under webpack. The README's old `.babelrc` setup turned
// SWC off and broke exactly this, so the fixture keeps a next/font import.
// run.mjs copies a font file that ships inside the installed `next` package.
const font = localFont({ src: "./fonts/TestFont.ttf", variable: "--font-test" });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={font.variable}>
      <body>
        {/* Next 14 has no instrumentation-client.ts, so the README's fallback
            (a "use client" component rendered by the root layout) loads the
            runtime there. run.mjs sets HEAP_RUNTIME_VIA=component for it. */}
        {process.env.HEAP_RUNTIME_VIA === "component" ? <HeapRuntime /> : null}
        {children}
      </body>
    </html>
  );
}
