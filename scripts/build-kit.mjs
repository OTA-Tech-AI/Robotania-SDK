/**
 * Package the platform-native Agent Kit. Linux uses a tarball; Windows uses
 * a ZIP that expands cleanly in PowerShell and Windows Terminal.
 */
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { createZip } from "./create-zip.mjs";
import { releasePlatform, writeSha256 } from "./release-utils.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const { osArch, extension, archiveExtension, isWindows } = releasePlatform();
const kitName = `robotania-agent-kit-${version}-${osArch}`;
const releaseDir = resolve(root, "release");
const binaryName = `robotania-${version}-${osArch}${extension}`;
const binarySource = join(releaseDir, binaryName);
const stagingRoot = join(releaseDir, ".kit-staging");
const stagingDir = join(stagingRoot, kitName);
const archive = join(releaseDir, `${kitName}${archiveExtension}`);

if (!existsSync(binarySource)) {
  throw new Error(`Binary missing: ${binarySource}. Run build:binary first.`);
}
if (!existsSync(resolve(root, "INSTALL.md"))) {
  throw new Error("INSTALL.md is required to build the Agent Kit.");
}

rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(join(stagingDir, "bin"), { recursive: true });
copyFileSync(binarySource, join(stagingDir, "bin", `robotania${extension}`));
if (!isWindows) chmodSync(join(stagingDir, "bin", "robotania"), 0o755);
cpSync(resolve(root, "docs"), join(stagingDir, "docs"), { recursive: true });
copyFileSync(resolve(root, "INSTALL.md"), join(stagingDir, "INSTALL.md"));
writeFileSync(join(stagingDir, "VERSION"), `${version}\n`, "utf8");

if (isWindows) {
  createZip({ sourceDirectory: stagingDir, outputFile: archive, rootName: kitName });
} else {
  execFileSync("tar", ["-czf", archive, "-C", stagingRoot, kitName], { stdio: "inherit" });
}
rmSync(stagingRoot, { recursive: true, force: true });

const { digest } = writeSha256(archive);
console.log(`Agent Kit: release/${kitName}${archiveExtension}`);
console.log(`Checksum: release/${kitName}${archiveExtension}.sha256`);
console.log(`  ${digest}`);
