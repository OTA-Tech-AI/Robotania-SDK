import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { writeSha256 } from "./release-utils.mjs";
import { runNpm } from "./run-package-command.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const releaseDir = resolve(root, "release");
const packageFile = join(releaseDir, `robotania-agent-sdk-${version}.tgz`);

mkdirSync(releaseDir, { recursive: true });
runNpm(["pack", "--pack-destination", releaseDir], { cwd: root, stdio: "inherit" });
if (!existsSync(packageFile)) {
  throw new Error(`npm pack did not create ${packageFile}`);
}

execFileSync(process.execPath, [resolve(root, "scripts/verify-npm-package.mjs"), packageFile], {
  cwd: root,
  stdio: "inherit",
});
writeSha256(packageFile);
console.log(`npm package checksum: release/robotania-agent-sdk-${version}.tgz.sha256`);
