import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm, runPackageCommand } from "./run-package-command.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const packageFile = resolve(process.argv[2] ?? join(root, "release", `robotania-agent-sdk-${manifest.version}.tgz`));
const workDir = mkdtempSync(join(tmpdir(), "robotania-npm-verify-"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function listFiles(path, prefix = "") {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const relative = join(prefix, entry.name);
    return entry.isDirectory() ? listFiles(join(path, entry.name), relative) : [relative];
  });
}

try {
  assert(isAbsolute(packageFile), "Package path must resolve to an absolute path");
  runNpm(
    ["install", "--prefix", workDir, "--ignore-scripts", "--no-audit", "--no-fund", packageFile],
    { cwd: root, stdio: "inherit" },
  );

  const installedRoot = join(workDir, "node_modules", "@robotania", "agent-sdk");
  const installedManifest = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
  assert(installedManifest.name === manifest.name, `Installed package name is ${installedManifest.name}`);
  assert(installedManifest.version === manifest.version, `Installed package version is ${installedManifest.version}`);

  const allowedRoots = new Set(["LICENSE", "README.md", "dist", "docs", "package.json"]);
  const installedFiles = listFiles(installedRoot);
  for (const file of installedFiles) {
    const topLevel = file.split(/[\\/]/, 1)[0];
    assert(allowedRoots.has(topLevel), `Unexpected file in npm package: ${file}`);
    assert(!/(^|[\\/])(?:\.env(?:\.|$)|\.wallet\.json$)/i.test(file), `Sensitive file in npm package: ${file}`);
  }

  for (const [command, relativePath] of Object.entries(installedManifest.bin ?? {})) {
    const source = readFileSync(join(installedRoot, relativePath), "utf8");
    assert(/^#!\/usr\/bin\/env node\r?\n/.test(source), `${command} entry point is missing its Node.js shebang`);
  }

  const binDir = join(workDir, "node_modules", ".bin");
  const robotania = join(binDir, process.platform === "win32" ? "robotania.cmd" : "robotania");
  const version = runPackageCommand(robotania, ["--version"], { cwd: workDir, encoding: "utf8" }).trim();
  assert(version === manifest.version, `robotania --version returned ${version}`);
  runPackageCommand(robotania, ["docs", "check"], { cwd: workDir, stdio: "inherit" });
  const bridge = join(binDir, process.platform === "win32" ? "robotania-bridge.cmd" : "robotania-bridge");
  runPackageCommand(bridge, ["run", "--help"], { cwd: workDir, stdio: "pipe" });

  execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", "await import('@robotania/agent-sdk')"],
    { cwd: workDir, stdio: "inherit" },
  );

  console.log(`Verified installable npm package: ${basename(packageFile)}`);
} finally {
  rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
