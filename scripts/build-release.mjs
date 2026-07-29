import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const targetIndex = process.argv.indexOf("--target");
const requestedTarget = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;
const nativeTarget = process.platform === "win32"
  ? "win-x64"
  : process.platform === "darwin" && process.arch === "arm64"
    ? "macos-arm64"
    : process.platform === "linux" && process.arch === "x64"
      ? "linux-x64"
      : undefined;
const osArch = requestedTarget === "native" ? nativeTarget : requestedTarget;
if (osArch !== "linux-x64" && osArch !== "win-x64" && osArch !== "macos-arm64") {
  throw new Error(
    "Usage: node scripts/build-release.mjs --target native|linux-x64|win-x64|macos-arm64",
  );
}

const targetPlatform =
  osArch === "win-x64" ? "win32" : osArch === "macos-arm64" ? "darwin" : "linux";
if (process.platform !== targetPlatform) {
  throw new Error(
    `Refusing to build ${osArch} from ${process.platform}. Build each native artifact on its matching operating system.`,
  );
}
const targetArch = osArch.endsWith("-arm64") ? "arm64" : "x64";
if (process.arch !== targetArch) {
  throw new Error(`${osArch} artifacts must be built on a native ${targetArch} host.`);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const pkgTarget =
  osArch === "macos-arm64" ? "node22-macos-arm64" : `node22-${osArch}`;
const env = { ...process.env, PKG_OS_ARCH: osArch, PKG_TARGET: pkgTarget };
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
  console.log(`Smoke check: release/${name}-${version}-${osArch}${extension} ${args.join(" ")}`);
  execFileSync(executable, args, { cwd: root, stdio: "inherit" });
};

smoke("robotania", ["--help"]);
smoke("robotania-bridge", ["run", "--help"]);

if (osArch === "linux-x64") {
  run("build:docs-kit");
  run("pack:release");
}
