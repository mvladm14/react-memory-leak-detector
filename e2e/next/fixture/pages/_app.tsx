import type { AppProps } from "next/app";

// README (Pages Router): load the runtime from _app. This file also runs on
// the server, where Next loads node_modules with plain Node, so the runtime
// must be loadable by Node (it used to fail with ERR_MODULE_NOT_FOUND). And
// `next build` type-checks this import, including under the
// moduleResolution "node" tsconfig that Next 13/14 generate.
if (process.env.NODE_ENV === "development") import("react-memory-leak-detector/runtime");

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
