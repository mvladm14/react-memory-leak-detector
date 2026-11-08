// Runs after every build (npm "postbuild", after mark-dist-esm.js): verifies the
// built runtime can be loaded by plain Node, as Next.js does when it evaluates
// `pages/_app` or a client component's server render without bundling
// node_modules. Checks the real output rather than the build configuration.
//
// Two checks, because neither is enough on its own:
//   1. dist/package.json declares "type": "module". Recent Node (>=22.7,
//      >=20.19) guesses ESM for a typeless .js file that uses `import` syntax,
//      so a missing marker only logs a warning there; older Node fails with
//      "Cannot use import statement outside a module".
//   2. dist/runtime.js imports cleanly, which catches relative imports that
//      Node's ESM resolver can't find (e.g. "./config" instead of
//      "./config.js"). Outside a browser there is no `window`, so importing the
//      runtime has no side effects.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

function fail(message) {
  console.error(`[check-dist] ${message}`);
  process.exit(1);
}

let type;
try {
  type = JSON.parse(readFileSync(path.join(dist, "package.json"), "utf8")).type;
} catch (err) {
  fail(`cannot read dist/package.json (${err.message}); is mark-dist-esm.js running?`);
}
if (type !== "module") {
  fail(`dist/package.json must declare "type": "module" (found ${JSON.stringify(type)}).`);
}

try {
  await import(pathToFileURL(path.join(dist, "runtime.js")).href);
} catch (err) {
  fail(`Node cannot load dist/runtime.js: ${err.message}`);
}

console.log("[check-dist] dist/runtime.js loads in plain Node");
