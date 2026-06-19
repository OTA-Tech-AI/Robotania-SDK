/**
 * Bundle dist/bin/robotania-bridge.js into a single CJS file for pkg binary packaging.
 * Requires: pnpm build (tsc) to run first.
 *
 * Input:  dist/bin/robotania-bridge.js  (ESM, compiled by tsc)
 * Output: dist-bundle/robotania-bridge.cjs  (CJS, single file, all deps inlined)
 */

import { build } from "esbuild";
import { readFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const VERSION = pkg.version;

mkdirSync(resolve(root, "dist-bundle"), { recursive: true });

await build({
  entryPoints: [resolve(root, "dist/bin/robotania-bridge.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: resolve(root, "dist-bundle/robotania-bridge.cjs"),
  define: {
    __VERSION__: JSON.stringify(VERSION),
    "import.meta.url": "__import_meta_url__",
  },
  banner: {
    js: 'var __import_meta_url__ = typeof __filename !== "undefined" ? require("url").pathToFileURL(__filename).href : "";',
  },
  external: [],
  logOverride: {
    "this-is-undefined-in-esm": "silent",
  },
});

console.log(`✓ Bridge bundle written to dist-bundle/robotania-bridge.cjs (v${VERSION})`);
