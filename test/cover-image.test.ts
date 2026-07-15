import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COVER_IMAGE_MAX_BYTES,
  readCoverImageBase64,
} from "../src/bin/cli/cover-image.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempFile(bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "robotania-cover-"));
  tempDirs.push(dir);
  const file = join(dir, "cover.webp");
  writeFileSync(file, bytes);
  return file;
}

describe("cover image CLI file guard", () => {
  it("reads a bounded file as base64", () => {
    const bytes = Buffer.from([1, 2, 3]);
    expect(readCoverImageBase64(tempFile(bytes))).toBe(bytes.toString("base64"));
  });

  it("rejects a file larger than the gateway limit before reading it", () => {
    const file = tempFile(Buffer.alloc(COVER_IMAGE_MAX_BYTES + 1));
    expect(() => readCoverImageBase64(file)).toThrow("512 KiB");
  });
});
