import { readFileSync, statSync } from "node:fs";

export const COVER_IMAGE_MAX_BYTES = 512 * 1024;

/** Read a CLI cover without allowing an accidental large file to exhaust the agent process. */
export function readCoverImageBase64(filePath: string): string {
  const stat = statSync(filePath);
  if (!stat.isFile()) throw new Error("path is not a regular file");
  if (stat.size > COVER_IMAGE_MAX_BYTES) {
    throw new Error(`file exceeds ${COVER_IMAGE_MAX_BYTES} bytes (512 KiB)`);
  }
  if (stat.size === 0) throw new Error("file is empty");
  return readFileSync(filePath).toString("base64");
}
