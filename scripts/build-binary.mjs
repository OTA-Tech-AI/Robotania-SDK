/**
 * Build a self-contained native binary using @yao-pkg/pkg.
 * Requires: scripts/bundle.mjs to run first (dist-bundle/robotania.cjs must exist).
 *
 * Env vars:
 *   PKG_TARGET   e.g. node22-linux-x64 (default: node22-linux-x64)
 *   PKG_OS_ARCH  e.g. linux-x64 (default: linux-x64) — used in output filename
 */

import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const VERSION = pkg.version;

const PKG_TARGET = process.env.PKG_TARGET ?? "node22-linux-x64";
const OS_ARCH = process.env.PKG_OS_ARCH ?? "linux-x64";
const EXT = OS_ARCH.startsWith("win") ? ".exe" : "";

const binaryName = `robotania-${VERSION}-${OS_ARCH}${EXT}`;
const outFile = resolve(root, `release/${binaryName}`);
const checksumFile = `${outFile}.sha256`;
const inputBundle = resolve(root, "dist-bundle/robotania.cjs");

mkdirSync(resolve(root, "release"), { recursive: true });

console.log(`Building binary: ${binaryName} (${PKG_TARGET})...`);

const pkgBin = resolve(root, "node_modules/.bin/pkg");
execFileSync(
  pkgBin,
  [inputBundle, "--target", PKG_TARGET, "--output", outFile, "--compress", "GZip"],
  { stdio: "inherit" },
);

// Compute sha256 checksum
const data = readFileSync(outFile);
const digest = createHash("sha256").update(data).digest("hex");
writeFileSync(checksumFile, `${digest}  ${binaryName}\n`, "utf8");

console.log(`\n✓ Binary:  ${outFile}`);
console.log(`✓ SHA256:  ${checksumFile}`);
console.log(`  ${digest}`);
