// Copyright (c) 2026 OTA-Tech-AI
// SPDX-License-Identifier: MPL-2.0
import { createHash } from "crypto";
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { createRequire } from "module";

export const releaseLegalFiles = ["LICENSE", "SOURCE.md", "THIRD_PARTY_NOTICES.md"];

export function releaseSourceUrl(version) {
  const ref = /-dev\.\d+$/.test(version) ? "main" : `v${version}`;
  return `https://github.com/OTA-Tech-AI/Robotania-SDK/tree/${ref}`;
}

export function releaseLegalNotice(root) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (manifest.license !== "MPL-2.0") throw new Error("Expected MPL-2.0 SDK license");
  const texts = releaseLegalFiles.map(name => readFileSync(join(root, name), "utf8").replace(/\r\n/g, "\n"));
  const sourceLine = `- Source: ${releaseSourceUrl(manifest.version)}`;
  if (!texts[1].split("\n").includes(sourceLine)) {
    throw new Error("SOURCE.md must identify this version's source location");
  }
  return [`Robotania Agent SDK v${manifest.version}\nCopyright (c) 2026 OTA-Tech-AI`,
    ...texts].join("\n\n");
}

export function validateComponentNotices(root) {
  const notices = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8").replace(/\r\n/g, "\n");
  const manifestFile = join(root, "package.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const seen = new Set();
  function check(directory) {
    const file = join(directory, "package.json");
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!notices.includes(`## ${key}\n`)) throw new Error(`Missing component notice: ${key}`);
    const licenses = readdirSync(directory).filter(name =>
      /^(?:licen[sc]e|copying)(?:[._-]|$)/i.test(name) && statSync(join(directory, name)).isFile());
    if (!licenses.length) throw new Error(`Missing component license text: ${key}`);
    for (const name of licenses) {
      const text = readFileSync(join(directory, name), "utf8").replace(/\r\n/g, "\n").trim();
      if (!notices.includes(text)) throw new Error(`Update ${key} ${name} in THIRD_PARTY_NOTICES.md`);
    }
    return pkg;
  }
  function visit(name, from) {
    let directory = dirname(createRequire(from).resolve(name));
    while (directory !== dirname(directory)) {
      const file = join(directory, "package.json");
      if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).name === name) break;
      directory = dirname(directory);
    }
    const pkg = check(directory);
    if (pkg) for (const dependency of Object.keys(pkg.dependencies ?? {})) {
      visit(dependency, join(directory, "package.json"));
    }
  }
  for (const name of Object.keys(manifest.dependencies ?? {})) visit(name, manifestFile);
  const pkgFile = createRequire(manifestFile).resolve("@yao-pkg/pkg/package.json");
  check(dirname(pkgFile));
  const fetchFile = createRequire(pkgFile).resolve("@yao-pkg/pkg-fetch/package.json");
  check(dirname(fetchFile));
  const major = /^node(\d+)-/.exec(process.env.PKG_TARGET ?? "node22-linux-x64")?.[1];
  const versions = Object.keys(JSON.parse(readFileSync(join(dirname(fetchFile), "patches", "patches.json"), "utf8")))
    .filter(version => version.startsWith(`v${major}.`));
  if (!versions.length || versions.some(version => !notices.includes(`## Node.js ${version}\n`))) {
    throw new Error("Update embedded Node runtime notices for the selected pkg target");
  }
}

export function copyReleaseLegalFiles(root, destination) {
  validateComponentNotices(root);
  releaseLegalNotice(root);
  for (const name of releaseLegalFiles) copyFileSync(join(root, name), join(destination, name));
}

export function writeSha256(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Cannot checksum missing artifact: ${filePath}`);
  }

  const fileName = basename(filePath);
  const digest = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  const checksumPath = `${filePath}.sha256`;
  writeFileSync(checksumPath, `${digest}  ${fileName}\n`, "utf8");
  return { checksumPath, digest };
}

export function releasePlatform() {
  const osArch = process.env.PKG_OS_ARCH ?? "linux-x64";
  return {
    osArch,
    extension: osArch.startsWith("win") ? ".exe" : "",
    archiveExtension: osArch.startsWith("win") ? ".zip" : ".tar.gz",
    isWindows: osArch.startsWith("win"),
  };
}
