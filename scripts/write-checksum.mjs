import { resolve } from "path";
import { writeSha256 } from "./release-utils.mjs";

const files = process.argv.slice(2);
if (files.length === 0) {
  throw new Error("Usage: node scripts/write-checksum.mjs <artifact> [...artifact]");
}

for (const file of files) {
  const { checksumPath, digest } = writeSha256(resolve(file));
  console.log(`${digest}  ${checksumPath}`);
}
