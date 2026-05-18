/**
 * Bundle dist/bin/robotania.js into a single CJS file for pkg binary packaging.
 * Requires: pnpm build (tsc) to run first.
 *
 * Input:  dist/bin/robotania.js  (ESM, compiled by tsc)
 * Output: dist-bundle/robotania.cjs  (CJS, single file, all deps inlined)
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
  entryPoints: [resolve(root, "dist/bin/robotania.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: resolve(root, "dist-bundle/robotania.cjs"),
  define: {
    __VERSION__: JSON.stringify(VERSION),
    // Polyfill import.meta.url for CJS output (chain.ts uses it to locate deployed-addresses.json).
    // The banner below injects __import_meta_url__ as a real variable; we map the property to it.
    "import.meta.url": "__import_meta_url__",
  },
  // Inject the polyfill before the bundle body.
  banner: {
    js: 'var __import_meta_url__ = typeof __filename !== "undefined" ? require("url").pathToFileURL(__filename).href : "";',
  },
  // Bundle everything — viem ships a CJS distribution that esbuild resolves cleanly
  // when format=cjs + platform=node.
  // Only Node built-in modules are external (they're embedded in the pkg runtime).
  external: [],
  // Suppress noisy import.meta warnings from viem internals.
  logOverride: {
    "this-is-undefined-in-esm": "silent",
  },
  // No shebang banner — pkg needs a bare CJS file to bundle correctly.
  // The dist/bin/robotania.js (tsc output) keeps the shebang for npx use.
});

console.log(`✓ Bundle written to dist-bundle/robotania.cjs (v${VERSION})`);
