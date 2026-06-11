/**
 * Package two release artifacts:
 *
 *   robotania-agent-kit-{v}-{arch}.tar.gz   — binary + docs (for Kit users)
 *   robotania-docs-{v}.tar.gz               — docs only (for `robotania docs sync`)
 *
 * Kit directory structure (contract for resolveDocsDir in docs.ts):
 *   robotania-agent-kit-{v}-{arch}/
 *     VERSION
 *     INSTALL.md
 *     bin/robotania      ← binary; docs/ is a sibling of bin/
 *     docs/              ← same source as npm package docs/
 *
 * Docs-only tarball structure (contract for `docs sync` in docs.ts):
 *   robotania-docs-{v}/
 *     VERSION
 *     INDEX.md
 *     ...all other docs files
 *
 * Requires: scripts/build-binary.mjs to have run first (release/{binaryName} must exist).
 *
 * Env vars (same as build-binary.mjs):
 *   PKG_OS_ARCH  e.g. linux-x64 (default: linux-x64)
 */

import { createHash } from "crypto";
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, rmSync, cpSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";
import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const VERSION = pkg.version;

const OS_ARCH = process.env.PKG_OS_ARCH ?? "linux-x64";
const EXT = OS_ARCH.startsWith("win") ? ".exe" : "";

const binaryName = `robotania-${VERSION}-${OS_ARCH}${EXT}`;
const binarySource = resolve(root, `release/${binaryName}`);
const kitName = `robotania-agent-kit-${VERSION}-${OS_ARCH}`;
const kitTarball = resolve(root, `release/${kitName}.tar.gz`);
const kitChecksumFile = `${kitTarball}.sha256`;

// Staging directory (cleaned before each build)
const stagingDir = resolve(root, `release/.kit-staging/${kitName}`);

console.log(`Building Agent Kit: ${kitName}.tar.gz...`);

// Clean and create staging tree
rmSync(resolve(root, "release/.kit-staging"), { recursive: true, force: true });
mkdirSync(join(stagingDir, "bin"), { recursive: true });
mkdirSync(join(stagingDir, "docs"), { recursive: true });

// 1) Binary → bin/robotania
copyFileSync(binarySource, join(stagingDir, "bin", `robotania${EXT}`));
if (!EXT) chmodSync(join(stagingDir, "bin", "robotania"), 0o755);

// 2) docs/ → docs/
cpSync(resolve(root, "docs"), join(stagingDir, "docs"), { recursive: true });

// 3) VERSION file
writeFileSync(join(stagingDir, "VERSION"), `${VERSION}\n`, "utf8");

// 4) INSTALL.md — must be present at repo root before building the Kit
const installMdSrc = resolve(root, "INSTALL.md");
if (!existsSync(installMdSrc)) {
  throw new Error(
    `INSTALL.md not found at ${installMdSrc}.\n` +
    `It must exist in the repo root before running build-kit.`,
  );
}
copyFileSync(installMdSrc, join(stagingDir, "INSTALL.md"));

// 5) Create tarball (relative paths inside archive start at robotania-agent-kit-{v}/)
execFileSync(
  "tar",
  ["-czf", kitTarball, "-C", resolve(root, "release/.kit-staging"), kitName],
  { stdio: "inherit" },
);

// 6) Checksum
const data = readFileSync(kitTarball);
const digest = createHash("sha256").update(data).digest("hex");
writeFileSync(kitChecksumFile, `${digest}  ${kitName}.tar.gz\n`, "utf8");

// Clean Kit staging
rmSync(resolve(root, "release/.kit-staging"), { recursive: true, force: true });

console.log(`\n✓ Kit:    ${kitTarball}`);
console.log(`✓ SHA256: ${kitChecksumFile}`);
console.log(`  ${digest}`);

// ── Docs-only tarball (required by `robotania docs sync`) ──────────────────
const docsName = `robotania-docs-${VERSION}`;
const docsTarball = resolve(root, `release/${docsName}.tar.gz`);
const docsChecksumFile = `${docsTarball}.sha256`;
const docsStagingDir = resolve(root, `release/.docs-staging/${docsName}`);

console.log(`\nBuilding docs tarball: ${docsName}.tar.gz...`);

rmSync(resolve(root, "release/.docs-staging"), { recursive: true, force: true });
mkdirSync(docsStagingDir, { recursive: true });

// Copy all docs files flat into the staging dir
cpSync(resolve(root, "docs"), docsStagingDir, { recursive: true });

// Add a VERSION file so `docs check` can verify version alignment
writeFileSync(join(docsStagingDir, "VERSION"), `${VERSION}\n`, "utf8");

execFileSync(
  "tar",
  ["-czf", docsTarball, "-C", resolve(root, "release/.docs-staging"), docsName],
  { stdio: "inherit" },
);

const docsData = readFileSync(docsTarball);
const docsDigest = createHash("sha256").update(docsData).digest("hex");
writeFileSync(docsChecksumFile, `${docsDigest}  ${docsName}.tar.gz\n`, "utf8");

rmSync(resolve(root, "release/.docs-staging"), { recursive: true, force: true });

console.log(`\n✓ Docs:   ${docsTarball}`);
console.log(`✓ SHA256: ${docsChecksumFile}`);
console.log(`  ${docsDigest}`);
