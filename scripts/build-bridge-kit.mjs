/**
 * Package the optional Bridge Kit release artifact:
 *
 *   robotania-bridge-kit-{v}-{arch}.tar.gz — bridge binary + bridge docs + BRIDGE_INSTALL.md
 *
 * Directory structure:
 *   robotania-bridge-kit-{v}-{arch}/
 *     VERSION
 *     BRIDGE_INSTALL.md
 *     bin/robotania-bridge
 *     docs/              ← bridge-relevant docs only (not full agent kit)
 *
 * Requires: scripts/build-bridge-binary.mjs to have run first.
 *
 * Env vars (same as build-bridge-binary.mjs):
 *   PKG_OS_ARCH  e.g. linux-x64 (default: linux-x64)
 */

import { createHash } from "crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  chmodSync,
  rmSync,
  cpSync,
  existsSync,
} from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";
import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const VERSION = pkg.version;

const OS_ARCH = process.env.PKG_OS_ARCH ?? "linux-x64";
const EXT = OS_ARCH.startsWith("win") ? ".exe" : "";

const binaryName = `robotania-bridge-${VERSION}-${OS_ARCH}${EXT}`;
const binarySource = resolve(root, `release/${binaryName}`);
const kitName = `robotania-bridge-kit-${VERSION}-${OS_ARCH}`;
const kitTarball = resolve(root, `release/${kitName}.tar.gz`);
const kitChecksumFile = `${kitTarball}.sha256`;

const BRIDGE_DOCS = [
  "00-important-notes.md",
  "07-stay-online.md",
  "14-robotania-bridge.md",
];

const stagingDir = resolve(root, `release/.bridge-kit-staging/${kitName}`);

if (!existsSync(binarySource)) {
  throw new Error(
    `Bridge binary missing: ${binarySource}\nRun: pnpm build:bundle:bridge && pnpm build:binary:bridge`,
  );
}

console.log(`Building Bridge Kit: ${kitName}.tar.gz...`);

rmSync(resolve(root, "release/.bridge-kit-staging"), { recursive: true, force: true });
mkdirSync(join(stagingDir, "bin"), { recursive: true });
mkdirSync(join(stagingDir, "docs"), { recursive: true });

copyFileSync(binarySource, join(stagingDir, "bin", `robotania-bridge${EXT}`));
if (!EXT) chmodSync(join(stagingDir, "bin", "robotania-bridge"), 0o755);

for (const doc of BRIDGE_DOCS) {
  const src = resolve(root, "docs", doc);
  if (!existsSync(src)) {
    throw new Error(`Required bridge doc missing: ${src}`);
  }
  cpSync(src, join(stagingDir, "docs", doc));
}

writeFileSync(join(stagingDir, "VERSION"), `${VERSION}\n`, "utf8");

const installMdSrc = resolve(root, "BRIDGE_INSTALL.md");
if (!existsSync(installMdSrc)) {
  throw new Error(
    `BRIDGE_INSTALL.md not found at ${installMdSrc}.\n` +
    `It must exist in the repo root before running build-bridge-kit.`,
  );
}
copyFileSync(installMdSrc, join(stagingDir, "BRIDGE_INSTALL.md"));

execFileSync(
  "tar",
  ["-czf", kitTarball, "-C", resolve(root, "release/.bridge-kit-staging"), kitName],
  { stdio: "inherit" },
);

const data = readFileSync(kitTarball);
const digest = createHash("sha256").update(data).digest("hex");
writeFileSync(kitChecksumFile, `${digest}  ${kitName}.tar.gz\n`, "utf8");

rmSync(resolve(root, "release/.bridge-kit-staging"), { recursive: true, force: true });

console.log(`\n✓ Bridge Kit: ${kitTarball}`);
console.log(`✓ SHA256:     ${kitChecksumFile}`);
console.log(`  ${digest}`);
