/**
 * Build a self-contained native binary using @yao-pkg/pkg.
 * Requires: scripts/bundle.mjs to run first (dist-bundle/robotania.cjs must exist).
 *
 * Env vars:
 *   PKG_TARGET   e.g. node22-linux-x64 (default: node22-linux-x64)
 *   PKG_OS_ARCH  e.g. linux-x64 (default: linux-x64) — used in output filename
 */

import { execFileSync } from "child_process";
import { mkdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { writeSha256 } from "./release-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const VERSION = pkg.version;

const PKG_TARGET = process.env.PKG_TARGET ?? "node22-linux-x64";
const OS_ARCH = process.env.PKG_OS_ARCH ?? "linux-x64";
const EXT = OS_ARCH.startsWith("win") ? ".exe" : "";
const targetPlatform = OS_ARCH.startsWith("win") ? "win32" : "linux";

if (process.platform !== targetPlatform) {
  throw new Error(
    `Refusing to build ${OS_ARCH} from ${process.platform}. Build Windows artifacts in native Windows PowerShell and Linux artifacts on Linux.`,
  );
}

const binaryName = `robotania-${VERSION}-${OS_ARCH}${EXT}`;
const outFile = resolve(root, `release/${binaryName}`);
const inputBundle = resolve(root, "dist-bundle/robotania.cjs");

mkdirSync(resolve(root, "release"), { recursive: true });

console.log(`Building binary: ${binaryName} (${PKG_TARGET})...`);

// Invoke pkg through Node instead of its platform-specific shell wrapper. This
// works consistently in PowerShell and avoids relying on pkg.CMD being directly
// executable through child_process.
const pkgEntrypoint = resolve(root, "node_modules/@yao-pkg/pkg/lib-es5/bin.js");
execFileSync(
  process.execPath,
  [pkgEntrypoint, inputBundle, "--target", PKG_TARGET, "--output", outFile, "--compress", "GZip"],
  { stdio: "inherit" },
);

const { checksumPath: checksumFile, digest } = writeSha256(outFile);

console.log(`\n✓ Binary:  ${outFile}`);
console.log(`✓ SHA256:  ${checksumFile}`);
console.log(`  ${digest}`);
