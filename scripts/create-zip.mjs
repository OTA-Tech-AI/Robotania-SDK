/**
 * Create a standards-compliant deflated ZIP using Node's built-in modules.
 * Keeping this local avoids a platform-specific archive command or runtime
 * dependency in release builds.
 */
import { createHash } from "crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { deflateRawSync } from "zlib";
import { basename, join, relative, resolve, sep } from "path";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980) - 1980;
  return {
    date: (year << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function walkFiles(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(root, path) : [path];
  });
}

function uint16(value) {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function uint32(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

export function createZip({ sourceDirectory, outputFile, rootName = basename(sourceDirectory) }) {
  const sourceRoot = resolve(sourceDirectory);
  const entries = walkFiles(sourceRoot).map((filePath) => {
    const source = readFileSync(filePath);
    const name = `${rootName}/${relative(sourceRoot, filePath).split(sep).join("/")}`;
    const nameBuffer = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(source, { level: 9 });
    const { date, time } = dosDateTime(statSync(filePath).mtime);
    return { source, nameBuffer, compressed, crc: crc32(source), date, time };
  });

  let offset = 0;
  const localRecords = [];
  const centralRecords = [];
  for (const entry of entries) {
    const local = Buffer.concat([
      uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(8),
      uint16(entry.time), uint16(entry.date), uint32(entry.crc),
      uint32(entry.compressed.length), uint32(entry.source.length),
      uint16(entry.nameBuffer.length), uint16(0), entry.nameBuffer, entry.compressed,
    ]);
    localRecords.push(local);
    centralRecords.push(Buffer.concat([
      uint32(0x02014b50), uint16(0x0314), uint16(20), uint16(0x0800), uint16(8),
      uint16(entry.time), uint16(entry.date), uint32(entry.crc),
      uint32(entry.compressed.length), uint32(entry.source.length),
      uint16(entry.nameBuffer.length), uint16(0), uint16(0), uint16(0), uint16(0),
      uint32(0), uint32(offset), entry.nameBuffer,
    ]));
    offset += local.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const output = Buffer.concat([
    ...localRecords,
    centralDirectory,
    uint32(0x06054b50), uint16(0), uint16(0), uint16(entries.length), uint16(entries.length),
    uint32(centralDirectory.length), uint32(offset), uint16(0),
  ]);
  writeFileSync(outputFile, output);
  return { entries: entries.length, sha256: createHash("sha256").update(output).digest("hex") };
}
