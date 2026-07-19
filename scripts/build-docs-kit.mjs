import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { writeSha256 } from "./release-utils.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const docsName = `robotania-docs-${version}`;
const releaseDir = resolve(root, "release");
const stagingRoot = resolve(releaseDir, ".docs-staging");
const stagingDir = join(stagingRoot, docsName);
const archive = join(releaseDir, `${docsName}.tar.gz`);

if (!existsSync(resolve(root, "docs"))) {
  throw new Error("docs/ is required to build the documentation archive.");
}

rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
cpSync(resolve(root, "docs"), stagingDir, { recursive: true });
writeFileSync(join(stagingDir, "VERSION"), `${version}\n`, "utf8");
execFileSync("tar", ["-czf", archive, "-C", stagingRoot, docsName], { stdio: "inherit" });
rmSync(stagingRoot, { recursive: true, force: true });

writeSha256(archive);
console.log(`Docs archive: release/${docsName}.tar.gz`);
console.log(`Checksum: release/${docsName}.tar.gz.sha256`);
