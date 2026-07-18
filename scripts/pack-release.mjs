import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { writeSha256 } from "./release-utils.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const releaseDir = resolve(root, "release");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const packageFile = join(releaseDir, `robotania-agent-sdk-${version}.tgz`);

mkdirSync(releaseDir, { recursive: true });
execFileSync(npm, ["pack", "--pack-destination", releaseDir], { cwd: root, stdio: "inherit" });
if (!existsSync(packageFile)) {
  throw new Error(`npm pack did not create ${packageFile}`);
}

const { checksumPath } = writeSha256(packageFile);
console.log(`npm package checksum: ${checksumPath}`);
