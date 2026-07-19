/** Package the platform-native optional Bridge Kit. */
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { createZip } from "./create-zip.mjs";
import { releasePlatform, writeSha256 } from "./release-utils.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const { osArch, extension, archiveExtension, isWindows } = releasePlatform();
const kitName = `robotania-bridge-kit-${version}-${osArch}`;
const releaseDir = resolve(root, "release");
const binaryName = `robotania-bridge-${version}-${osArch}${extension}`;
const binarySource = join(releaseDir, binaryName);
const stagingRoot = join(releaseDir, ".bridge-kit-staging");
const stagingDir = join(stagingRoot, kitName);
const archive = join(releaseDir, `${kitName}${archiveExtension}`);
const bridgeDocs = ["00-important-notes.md", "07-stay-online.md", "14-robotania-bridge.md"];

if (!existsSync(binarySource)) {
  throw new Error(`Bridge binary missing: ${binarySource}. Run build:binary:bridge first.`);
}
if (!existsSync(resolve(root, "BRIDGE_INSTALL.md"))) {
  throw new Error("BRIDGE_INSTALL.md is required to build the Bridge Kit.");
}

rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(join(stagingDir, "bin"), { recursive: true });
mkdirSync(join(stagingDir, "docs"), { recursive: true });
copyFileSync(binarySource, join(stagingDir, "bin", `robotania-bridge${extension}`));
if (!isWindows) chmodSync(join(stagingDir, "bin", "robotania-bridge"), 0o755);
for (const document of bridgeDocs) {
  const source = resolve(root, "docs", document);
  if (!existsSync(source)) throw new Error(`Required bridge doc missing: ${source}`);
  cpSync(source, join(stagingDir, "docs", document));
}
copyFileSync(resolve(root, "BRIDGE_INSTALL.md"), join(stagingDir, "BRIDGE_INSTALL.md"));
writeFileSync(join(stagingDir, "VERSION"), `${version}\n`, "utf8");

if (isWindows) {
  createZip({ sourceDirectory: stagingDir, outputFile: archive, rootName: kitName });
} else {
  execFileSync("tar", ["-czf", archive, "-C", stagingRoot, kitName], { stdio: "inherit" });
}
rmSync(stagingRoot, { recursive: true, force: true });

const { digest } = writeSha256(archive);
console.log(`Bridge Kit: release/${kitName}${archiveExtension}`);
console.log(`Checksum: release/${kitName}${archiveExtension}.sha256`);
console.log(`  ${digest}`);
