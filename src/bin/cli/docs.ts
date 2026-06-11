/**
 * `robotania docs` sub-commands: path | check | sync
 *
 * resolveDocsDir() resolution order (pkg binary safe):
 *   1. ROBOTANIA_DOCS_DIR env var
 *   2. dirname(process.execPath) + "/../docs"  ← Kit layout: bin/ sibling to docs/
 *   3. ~/.robotania/robotania-docs-{VERSION}/  ← docs sync target
 *   4. undefined (not found)
 *
 * Note: require.resolve() is intentionally NOT used — it fails inside pkg binaries.
 */

import {
  existsSync,
  mkdirSync,
  createWriteStream,
  readFileSync,
  rmSync,
  renameSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// __VERSION__ is replaced by esbuild during bundle; falls back to package.json at runtime.
declare const __VERSION__: string;
function cliVersion(): string {
  try {
    return __VERSION__;
  } catch {
    // Fallback: read package.json relative to this file (non-bundled dev usage)
    try {
      const pkgPath = resolve(dirname(new URL(import.meta.url).pathname), "../../../package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
      return pkg.version;
    } catch {
      return "unknown";
    }
  }
}

export function resolveDocsDir(): string | undefined {
  const VERSION = cliVersion();

  // 1. Explicit env override
  if (process.env.ROBOTANIA_DOCS_DIR) {
    const d = process.env.ROBOTANIA_DOCS_DIR;
    if (existsSync(join(d, "INDEX.md"))) return d;
    // Env set but path invalid — still return it so the caller can report the problem
    return d;
  }

  // 2. Kit layout: docs/ is a sibling of the bin/ directory containing this binary.
  //    process.execPath is the Node binary in dev mode, but the actual robotania binary
  //    in pkg mode. In pkg mode process.execPath points to the robotania binary itself,
  //    which lives in bin/ → ../docs resolves to the Kit docs directory.
  try {
    const candidate = resolve(dirname(process.execPath), "..", "docs");
    if (existsSync(join(candidate, "INDEX.md"))) return candidate;
  } catch { /* ignore */ }

  // 3. docs sync target: ~/.robotania/robotania-docs-{VERSION}/
  if (VERSION !== "unknown") {
    const candidate = join(homedir(), ".robotania", `robotania-docs-${VERSION}`);
    if (existsSync(join(candidate, "INDEX.md"))) return candidate;
  }

  return undefined;
}

function docsVersionFile(docsDir: string): string {
  return join(docsDir, "VERSION");
}

function checkDocs(docsDir: string | undefined, VERSION: string): { ok: boolean; reason?: string } {
  if (!docsDir) return { ok: false, reason: "docs directory not found" };
  if (!existsSync(join(docsDir, "INDEX.md"))) {
    return { ok: false, reason: `INDEX.md missing in ${docsDir}` };
  }
  const versionFile = docsVersionFile(docsDir);
  if (existsSync(versionFile)) {
    const docVer = readFileSync(versionFile, "utf8").trim();
    if (docVer !== VERSION) {
      return { ok: false, reason: `version mismatch: CLI ${VERSION}, docs ${docVer}` };
    }
  }
  return { ok: true };
}

/** Minimal tar entry parser for .tar.gz streams — handles ustar/POSIX format. */
async function extractTarGz(stream: Readable, destDir: string): Promise<void> {
  const gunzip = createGunzip();
  const chunks: Buffer[] = [];

  await pipeline(stream, gunzip, async (source) => {
    for await (const chunk of source) {
      chunks.push(chunk as Buffer);
    }
  });

  const buf = Buffer.concat(chunks);
  let offset = 0;
  const BLOCK = 512;

  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);
    offset += BLOCK;

    // End-of-archive: two consecutive zero blocks
    if (header.every((b) => b === 0)) break;

    const nameRaw = header.subarray(0, 100);
    const name = nameRaw.subarray(0, nameRaw.indexOf(0)).toString("utf8");
    if (!name) break;

    const sizeStr = header.subarray(124, 136).subarray(0, 12).toString("ascii").trim().replace(/\0/g, "");
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = String.fromCharCode(header[156] || 0);

    // Strip leading component (e.g. "robotania-docs-0.1.16/") to get relative path
    const parts = name.split("/");
    const rel = parts.slice(1).join("/");

    if (rel && typeFlag !== "5") {
      // Regular file
      const dest = join(destDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      const content = buf.subarray(offset, offset + size);
      const ws = createWriteStream(dest);
      await new Promise<void>((res, rej) => {
        ws.write(content, (err) => { if (err) rej(err); else { ws.end(); ws.on("finish", res); ws.on("error", rej); } });
      });
    } else if (rel && typeFlag === "5") {
      // Directory
      mkdirSync(join(destDir, rel), { recursive: true });
    }

    // Advance past file data (rounded up to 512-byte boundary)
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
}

export async function runDocs(args: string[]): Promise<void> {
  const sub = args[0];
  const VERSION = cliVersion();

  if (sub === "path") {
    const d = resolveDocsDir();
    if (!d || !existsSync(join(d, "INDEX.md"))) {
      process.stderr.write("Docs not found. Run: robotania docs sync\n");
      process.stderr.write(`Or set ROBOTANIA_DOCS_DIR to your docs directory.\n`);
      process.exit(1);
    }
    process.stdout.write(resolve(d) + "\n");
    return;
  }

  if (sub === "check") {
    const d = resolveDocsDir();
    const { ok, reason } = checkDocs(d, VERSION);
    if (ok) {
      process.stdout.write(`ok  ${resolve(d!)}\n`);
      process.exit(0);
    } else {
      process.stderr.write(`Docs check failed: ${reason}\n`);
      process.stderr.write(`Run: robotania docs sync\n`);
      process.exit(1);
    }
    return;
  }

  if (sub === "sync") {
    if (VERSION === "unknown") {
      process.stderr.write("Cannot sync: CLI version unknown. Use the official Kit or npm package.\n");
      process.exit(1);
    }

    const tarballUrl =
      `https://github.com/OTA-Tech-AI/Robotania-SDK/releases/download/v${VERSION}/` +
      `robotania-docs-${VERSION}.tar.gz`;

    const destDir = join(homedir(), ".robotania", `robotania-docs-${VERSION}`);
    const tmpDir = `${destDir}.tmp`;

    process.stderr.write(`Downloading docs v${VERSION}...\n  ${tarballUrl}\n`);

    let resp: Response;
    try {
      resp = await fetch(tarballUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`Download failed: ${msg}\n`);
      process.stderr.write(`Tip: If you installed via the Agent Kit, docs are already in docs/ beside the binary.\n`);
      process.exit(1);
    }

    if (!resp.ok) {
      process.stderr.write(`Download failed: HTTP ${resp.status} ${resp.statusText}\n`);
      process.stderr.write(`Check https://github.com/OTA-Tech-AI/Robotania-SDK/releases for available versions.\n`);
      process.exit(1);
    }

    // Extract to tmp then rename atomically
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });

    try {
      const nodeStream = Readable.fromWeb(resp.body as import("stream/web").ReadableStream);
      await extractTarGz(nodeStream, tmpDir);
    } catch (e) {
      rmSync(tmpDir, { recursive: true, force: true });
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`Extraction failed: ${msg}\n`);
      process.exit(1);
    }

    // The tarball extracts a top-level directory; move its contents up
    rmSync(destDir, { recursive: true, force: true });
    // If the tarball placed files under a subdirectory, hoist them
    const { readdirSync } = await import("node:fs");
    const entries = readdirSync(tmpDir);
    if (entries.length === 1 && existsSync(join(tmpDir, entries[0], "INDEX.md"))) {
      renameSync(join(tmpDir, entries[0]), destDir);
      rmSync(tmpDir, { recursive: true, force: true });
    } else if (existsSync(join(tmpDir, "INDEX.md"))) {
      renameSync(tmpDir, destDir);
    } else {
      rmSync(tmpDir, { recursive: true, force: true });
      process.stderr.write(`Extraction produced unexpected layout — INDEX.md not found.\n`);
      process.exit(1);
    }

    // Verify
    const { ok, reason } = checkDocs(destDir, VERSION);
    if (!ok) {
      process.stderr.write(`Sync completed but check failed: ${reason}\n`);
      process.exit(1);
    }

    process.stderr.write(`✓ Docs synced to ${destDir}\n`);
    process.stdout.write(resolve(destDir) + "\n");
    return;
  }

  // Unknown subcommand
  process.stderr.write(
    `Usage: robotania docs <path|check|sync>\n` +
    `  path   Print the resolved docs directory\n` +
    `  check  Verify docs are present and version-matched\n` +
    `  sync   Download docs for this CLI version from GitHub releases\n`,
  );
  process.exit(1);
}
