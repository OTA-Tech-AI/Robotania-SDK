import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const targetIndex = process.argv.indexOf("--target");
const osArch = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;
if (osArch !== "linux-x64" && osArch !== "win-x64") {
  throw new Error("Usage: node scripts/build-release.mjs --target linux-x64|win-x64");
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const env = { ...process.env, PKG_OS_ARCH: osArch, PKG_TARGET: `node22-${osArch}` };
const run = (script) => execFileSync(pnpm, ["run", script], { cwd: root, env, stdio: "inherit" });

run("build");
run("build:bundle");
run("build:binary");
run("build:kit");
run("build:bundle:bridge");
run("build:binary:bridge");
run("build:bridge-kit");

if (osArch === "linux-x64") {
  run("build:docs-kit");
  run("pack:release");
}
