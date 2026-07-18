import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const targetIndex = process.argv.indexOf("--target");
const osArch = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;
if (osArch !== "linux-x64" && osArch !== "win-x64") {
  throw new Error("Usage: node scripts/build-release.mjs --target linux-x64|win-x64");
}

const targetPlatform = osArch === "win-x64" ? "win32" : "linux";
if (process.platform !== targetPlatform) {
  throw new Error(
    `Refusing to build ${osArch} from ${process.platform}. Build Windows artifacts in native Windows PowerShell and Linux artifacts on Linux.`,
  );
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const env = { ...process.env, PKG_OS_ARCH: osArch, PKG_TARGET: `node22-${osArch}` };
const run = (script) => execFileSync(pnpm, ["run", script], {
  cwd: root,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

run("build");
run("build:bundle");
run("build:binary");
run("build:kit");
run("build:bundle:bridge");
run("build:binary:bridge");
run("build:bridge-kit");

const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const extension = osArch === "win-x64" ? ".exe" : "";
const smoke = (name, args) => {
  const executable = resolve(root, "release", `${name}-${version}-${osArch}${extension}`);
  console.log(`Smoke check: ${executable} ${args.join(" ")}`);
  execFileSync(executable, args, { cwd: root, stdio: "inherit" });
};

smoke("robotania", ["--help"]);
smoke("robotania-bridge", ["run", "--help"]);

if (osArch === "linux-x64") {
  run("build:docs-kit");
  run("pack:release");
}
