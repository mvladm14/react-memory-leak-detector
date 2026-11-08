// The runtime in dist/ is emitted as ESM and must be loadable by plain Node
// (Next.js evaluates pages/_app and client components' server renders without
// bundling node_modules). The build itself verifies the output after every
// `npm run build` (scripts/check-dist.mjs); this test catches the most likely
// regression earlier, in the source: Node's ESM resolver needs fully
// specified relative imports ("./config.js", not "./config").
const fs = require("fs");
const path = require("path");

it("uses fully specified relative imports in the runtime sources", () => {
  const srcDir = path.resolve(__dirname, "../src");
  for (const file of fs.readdirSync(srcDir)) {
    const text = fs.readFileSync(path.join(srcDir, file), "utf8");
    for (const [, spec] of text.matchAll(/from\s+["'](\.[^"']*)["']/g)) {
      expect(`${file}: ${spec}`).toMatch(/\.js$/);
    }
  }
});
