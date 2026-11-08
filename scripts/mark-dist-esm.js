// Runs after `tsc` (npm "postbuild"). The runtime in dist/ is emitted as ES
// modules, but the package root has no "type" field (the Vite/Next/Babel entry
// points are CommonJS). A nested package.json scopes dist/ as ESM so Node can
// load the runtime directly — e.g. when Next.js evaluates `_app.tsx` on the
// server, where node_modules are not bundled — instead of failing with
// ERR_MODULE_NOT_FOUND / "Cannot use import statement outside a module".
const fs = require("fs");
const path = require("path");

fs.writeFileSync(
  path.join(__dirname, "..", "dist", "package.json"),
  JSON.stringify({ type: "module" }, null, 2) + "\n",
);
