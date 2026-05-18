import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFileCb);

/**
 * Smoke-test the packaged `robotania` CLI emitted next to tests (`dist/` after `pnpm build`).
 * Long-running subprocesses use async exec so Vitest workers are not wedged synchronously.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const BINARY = resolve(__dirname, "../dist/bin/robotania.js");
const NODE = process.execPath;

type RunResult = { status: number; stdout: string; stderr: string };

function bufStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (x != null && typeof (x as Buffer).toString === "function") return (x as Buffer).toString("utf8");
  return "";
}

async function run(
  args: string[],
  env: Record<string, string> = {},
  opts: { cwd?: string } = {},
): Promise<RunResult> {
  try {
    const r = await execFileAsync(NODE, [BINARY, ...args], {
      env: { ...process.env, ...env },
      cwd: opts.cwd,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 35_000,
    });
    return {
      status: 0,
      stdout: bufStr(r.stdout),
      stderr: bufStr(r.stderr),
    };
  } catch (err: unknown) {
    const x = err as NodeJS.ErrnoException & {
      stdout?: unknown;
      stderr?: unknown;
      code?: number | string;
      status?: number;
    };
    const status =
      typeof x.code === "number"
        ? x.code
        : typeof x.status === "number"
          ? x.status
          : typeof x.code === "string" && /^\d+$/.test(x.code)
            ? Number(x.code)
            : x.code === "ETIMEDOUT"
              ? 124
              : 1;
    return { status, stdout: bufStr(x.stdout), stderr: bufStr(x.stderr) };
  }
}

describe("robotania CLI", () => {
  // ── --help ──────────────────────────────────────────────────────────────────

  it("--help prints usage and exits 0", async () => {
    const r = await run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("robotania — Robotania Agent SDK");
    expect(r.stdout).toContain("approve-bond");
    expect(r.stdout).toContain("deposit-collateral");
    expect(r.stdout).toContain("deposit-operational");
    expect(r.stdout).toContain("register-citizen");
  });

  it("-h alias exits 0", async () => {
    const r = await run(["-h"]);
    expect(r.status).toBe(0);
  });

  it("no args prints help and exits 0", async () => {
    const r = await run([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("USAGE");
  });

  // ── unknown command ─────────────────────────────────────────────────────────

  it("unknown command exits 1 and prints error to stderr", async () => {
    const r = await run(["definitely-not-a-command"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unknown command");
    expect(r.stderr).toContain("definitely-not-a-command");
  });

  // ── init ────────────────────────────────────────────────────────────────────

  describe("init", () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "robotania-init-test-"));
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("creates .wallet.json and .env.agent on first run", async () => {
      const r = await run(["init"], {}, { cwd: tmpDir });
      expect(r.status).toBe(0);
      expect(existsSync(join(tmpDir, ".wallet.json"))).toBe(true);
      expect(existsSync(join(tmpDir, ".env.agent"))).toBe(true);
    });

    it(".wallet.json contains a valid private key", () => {
      const wallet = JSON.parse(readFileSync(join(tmpDir, ".wallet.json"), "utf8")) as {
        privateKey?: string;
        address?: string;
      };
      expect(wallet.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it(".env.agent contains ROBOTANIA_PRIVATE_KEY", () => {
      const env = readFileSync(join(tmpDir, ".env.agent"), "utf8");
      expect(env).toContain("ROBOTANIA_PRIVATE_KEY=0x");
    });

    it("second init skips .env.agent if it exists", async () => {
      const r = await run(["init"], {}, { cwd: tmpDir });
      expect(r.status).toBe(0);
      expect(r.stderr).toContain("already exists");
    });
  });

  // ── approve-bond --dry-run ──────────────────────────────────────────────────

  it("approve-bond --dry-run prints dryRun JSON to stdout", async () => {
    const r = await run(
      ["approve-bond", "--dry-run"],
      {
        ROBOTANIA_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        ROBOTANIA_DEPLOYED_ADDRESSES_PATH: resolve(__dirname, "../../ops/deployed-addresses.json"),
      },
    );
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as {
      dryRun: boolean;
      action: string;
      token: string;
      spenders: { name: string; address: string }[];
    };
    expect(out.dryRun).toBe(true);
    expect(out.action).toBe("erc20_approve_all");
    expect(out.token).toMatch(/^0x/);
    expect(out.spenders.length).toBeGreaterThan(0);
    expect(out.spenders[0].address).toMatch(/^0x/);
  });

  // ── register-citizen --dry-run ──────────────────────────────────────────────

  it("register-citizen --dry-run prints signed gateway envelope preview", async () => {
    const r = await run(
      ["register-citizen", "--dry-run"],
      {
        ROBOTANIA_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        ROBOTANIA_DEPLOYED_ADDRESSES_PATH: resolve(__dirname, "../../ops/deployed-addresses.json"),
      },
    );
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as {
      dryRun: boolean;
      domain: { name: string; version: string; chainId: number };
      message: { method: string; path: string; citizenId: string; payloadHash: string };
    };
    expect(out.dryRun).toBe(true);
    expect(out.domain.name).toBe("Robotania");
    expect(out.domain.version).toBe("1");
    expect(out.message.method).toBe("POST");
    expect(out.message.path).toBe("/api/v1/agent/citizens/register");
    expect(out.message.citizenId).toBe("pending");
    expect(out.message.payloadHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  // ── missing private key ─────────────────────────────────────────────────────

  it("approve-bond without PRIVATE_KEY exits 1", async () => {
    const r = await run(
      ["approve-bond", "--dry-run"],
      { ROBOTANIA_DEPLOYED_ADDRESSES_PATH: resolve(__dirname, "../../ops/deployed-addresses.json") },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ROBOTANIA_PRIVATE_KEY");
  });
});
