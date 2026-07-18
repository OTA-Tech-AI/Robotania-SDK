import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { basename } from "path";

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
