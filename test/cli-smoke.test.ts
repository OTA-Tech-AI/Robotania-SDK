import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, parseAbi } from "viem";

const execFileAsync = promisify(execFileCb);

/**
 * Smoke-test the packaged `robotania` CLI emitted next to tests (`dist/` after `pnpm build`).
 * Long-running subprocesses use async exec so Vitest workers are not wedged synchronously.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const BINARY = resolve(__dirname, "../dist/bin/robotania.js");
const PACKAGE_VERSION = (JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { version: string }).version;
const NODE = process.execPath;

type RunResult = { status: number; stdout: string; stderr: string };

function bufStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (x != null && typeof (x as Buffer).toString === "function") return (x as Buffer).toString("utf8");
  return "";
}

async function run(
  args: string[],
  env: Record<string, string | undefined> = {},
  opts: { cwd?: string; preload?: string } = {},
): Promise<RunResult> {
  try {
    const r = await execFileAsync(NODE, [...(opts.preload ? ["--import", pathToFileURL(opts.preload).href] : []), BINARY, ...args], {
      env: { ...process.env, ...env },
      cwd: opts.cwd,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 60_000,
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
    expect(r.stdout).toContain("--wait waits for confirmation covering required changes");
    expect(r.stdout).not.toContain("current-version acknowledgement");
  });

  it("-h alias exits 0", async () => {
    const r = await run(["-h"]);
    expect(r.status).toBe(0);
  });

  it("--version reports the installed SDK version without loading a wallet", async () => {
    const r = await run(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(PACKAGE_VERSION);
  });

  it("--license provides source and component notices without wallet configuration", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "robotania-license-test-"));
    try {
      const r = await run(["--license"], {}, { cwd: tmpDir });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("Mozilla Public License Version 2.0");
      expect(r.stdout).toContain(readFileSync(resolve(__dirname, "../SOURCE.md"), "utf8").replace(/\r\n/g, "\n").trim());
      expect(r.stdout).toContain("Third-party notices");
      expect(r.stdout).toContain("Node.js v22.10.0");
      expect(existsSync(join(tmpDir, ".wallet.json"))).toBe(false);
      expect(existsSync(join(tmpDir, ".env.agent"))).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
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
      if (process.platform !== "win32") {
        expect(statSync(join(tmpDir, ".wallet.json")).mode & 0o777).toBe(0o600);
        expect(statSync(join(tmpDir, ".env.agent")).mode & 0o777).toBe(0o600);
      }
    });

    it(".wallet.json contains a valid private key", () => {
      const wallet = JSON.parse(readFileSync(join(tmpDir, ".wallet.json"), "utf8")) as {
        privateKey?: string;
        address?: string;
      };
      expect(wallet.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it("wallet-address prints only the wallet address", async () => {
      const wallet = JSON.parse(readFileSync(join(tmpDir, ".wallet.json"), "utf8")) as {
        address: string; privateKey: string;
      };
      const r = await run(["wallet-address"], {}, { cwd: tmpDir });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(wallet.address);
      expect(`${r.stdout}${r.stderr}`).not.toContain(wallet.privateKey);
    });

    it("explicit env-file selects the configured wallet while the bare command retains its keyfile behavior", async () => {
      const key = `0x${"33".repeat(32)}` as const;
      const configured = privateKeyToAccount(key).address;
      const keyfile = JSON.parse(readFileSync(join(tmpDir, ".wallet.json"), "utf8")) as { address: string; privateKey: string };
      writeFileSync(join(tmpDir, "configured.env"), `ROBOTANIA_PRIVATE_KEY=${key}\n`);
      const env = { ROBOTANIA_PRIVATE_KEY: undefined };
      const selected = await run(["--env-file", "configured.env", "wallet-address"], env, { cwd: tmpDir });
      expect(selected.status).toBe(0);
      expect(selected.stdout.trim()).toBe(configured);
      const bare = await run(["wallet-address"], { ROBOTANIA_PRIVATE_KEY: key }, { cwd: tmpDir });
      expect(bare.status).toBe(0);
      expect(bare.stdout.trim()).toBe(keyfile.address);
      expect(`${selected.stdout}${selected.stderr}${bare.stdout}${bare.stderr}`).not.toContain(key);
      expect(`${selected.stdout}${selected.stderr}`).not.toContain(keyfile.privateKey);
    });

    it("uses the same inherited-key precedence as signed actions", async () => {
      const key = `0x${"44".repeat(32)}` as const;
      writeFileSync(join(tmpDir, "precedence.env"), `ROBOTANIA_PRIVATE_KEY=0x${"55".repeat(32)}\n`);
      const r = await run(["--env-file", "precedence.env", "wallet-address"], { ROBOTANIA_PRIVATE_KEY: key }, { cwd: tmpDir });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(privateKeyToAccount(key).address);
      expect(`${r.stdout}${r.stderr}`).not.toContain(key);
    });

    it("fails an invalid configured key without leaking it or falling back to the keyfile", async () => {
      const invalid = "0xprivate-key-must-not-appear";
      writeFileSync(join(tmpDir, "invalid.env"), `ROBOTANIA_PRIVATE_KEY=${invalid}\n`);
      const r = await run(["--env-file", "invalid.env", "wallet-address"], { ROBOTANIA_PRIVATE_KEY: undefined }, { cwd: tmpDir });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("Could not resolve a valid configured wallet");
      expect(r.stderr).not.toContain(invalid);
      expect(r.stderr).not.toContain("0xprivate");
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

  it("withdraw-from-citizen-wallet rejects an invalid token instead of selecting the default", async () => {
    const r = await run(
      ["withdraw-from-citizen-wallet", "--to", "0x0000000000000000000000000000000000000021",
        "--amount", "1", "--token", "not-an-address", "--dry-run"],
      {
        ROBOTANIA_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        ROBOTANIA_DEPLOYED_ADDRESSES_PATH: resolve(__dirname, "fixtures/deployed-addresses.json"),
      },
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("--token requires a valid token address");
  });

  // ── approve-bond --dry-run ──────────────────────────────────────────────────

  it("approve-bond --dry-run prints dryRun JSON to stdout", async () => {
    const r = await run(
      ["approve-bond", "--dry-run"],
      {
        ROBOTANIA_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        ROBOTANIA_DEPLOYED_ADDRESSES_PATH: resolve(__dirname, "fixtures/deployed-addresses.json"),
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
        ROBOTANIA_CHAIN_ID: "421614",
        ROBOTANIA_CITIZEN_ACTION_RELAY: "0x00000000000000000000000000000000000000a1",
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
    expect(out.domain.chainId).toBe(421614);
    expect(out.message.method).toBe("POST");
    expect(out.message.path).toBe("/api/v1/agent/citizens/register");
    expect(out.message.citizenId).toBe("pending");
    expect(out.message.payloadHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  describe("waitlist refund", () => {
    const env = {
      ROBOTANIA_PRIVATE_KEY: `0x${"11".repeat(32)}`,
      ROBOTANIA_CHAIN_ID: "421614",
      ROBOTANIA_RPC_URL: "https://rpc.refund.example",
      ROBOTANIA_PROTOCOL_CONFIG: "0x1111111111111111111111111111111111111111",
      ROBOTANIA_CITIZEN_REGISTRY: "0x2222222222222222222222222222222222222222",
      ROBOTANIA_CITIZEN_ACTION_RELAY: "0x3333333333333333333333333333333333333333",
      ROBOTANIA_SETTLEMENT_TOKEN: "0x4444444444444444444444444444444444444444",
      ROBOTANIA_TOPIC_WAITLIST: "0x5555555555555555555555555555555555555555",
    };

    it("dispatches a direct refund preview without requesting a Terms review", async () => {
      const r = await run(["claim-waitlist-refund", "--topic-id", "123", "--citizen-id", "42", "--dry-run"], env);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ dryRun: true, action: "claimWaitlistRefund", topicId: "123", citizenId: "42" });
      expect(r.stderr).not.toContain("Operator review");
    });

    it.each(["--async", "--timeout-ms"])("rejects unsupported Gateway flag %s before discovery", async (flag) => {
      const r = await run(["claim-waitlist-refund", "--topic-id", "123", "--citizen-id", "42", flag,
        ...(flag === "--timeout-ms" ? ["1"] : [])], { ROBOTANIA_PRIVATE_KEY: "" });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("does not use Gateway --async or --timeout-ms flags");
    });

    it.each(["unknown", "repriced", "cancelled", "replaced", "repriced-reverted"] as const)("handles %s through the real viem replacement detector", async scenario => {
      const dir = mkdtempSync(join(tmpdir(), "robotania-refund-rpc-"));
      const preload = join(dir, "rpc.mjs");
      const hash = `0x${"ab".repeat(32)}`;
      const replacementHash = `0x${"cd".repeat(32)}`;
      const walletAddress = privateKeyToAccount(env.ROBOTANIA_PRIVATE_KEY as `0x${string}`).address;
      const input = encodeFunctionData({ abi: parseAbi(["function claimWaitlistRefund(uint256 topicId,uint256 citizenId)"]),
        functionName: "claimWaitlistRefund", args: [123n, 42n] });
      writeFileSync(preload, `
const scenario = "${scenario}";
const originalTimeout = globalThis.setTimeout;
if (scenario === "unknown") globalThis.setTimeout = (fn, ms, ...args) => originalTimeout(fn, ms === 90000 || ms === 3000 ? 1 : ms, ...args);
const original = {hash:"${hash}",from:"${walletAddress}",to:"${env.ROBOTANIA_TOPIC_WAITLIST}",nonce:"0x11",value:"0x0",input:"${input}",
  blockNumber:null,blockHash:null,transactionIndex:null,gas:"0x6aa4",maxFeePerGas:"0x4d7c6d00",maxPriorityFeePerGas:"0x7bfa480",type:"0x2",chainId:"0x66eee",v:"0x0",r:"0x1",s:"0x1",accessList:[]};
const replacement = {...original,hash:"${replacementHash}",blockNumber:"0x2",blockHash:"${replacementHash}",transactionIndex:"0x0",maxFeePerGas:"0x6b49d200"};
if (scenario === "cancelled") {replacement.to = original.from; replacement.input = "0x";}
if (scenario === "replaced") replacement.input = "0x1234";
const receipt = {transactionHash:replacement.hash,transactionIndex:"0x0",blockHash:replacement.blockHash,blockNumber:"0x2",from:replacement.from,to:replacement.to,
  cumulativeGasUsed:"0x5208",gasUsed:"0x5208",contractAddress:null,logs:[],logsBloom:"0x"+"00".repeat(256),status:scenario === "repriced-reverted" ? "0x0" : "0x1",effectiveGasPrice:"0x3b9aca00",type:"0x2"};
let broadcasts = 0;
globalThis.fetch = async (url, init) => {
  const endpoint = typeof url === "string" || url instanceof URL ? String(url) : url.url;
  if (new URL(endpoint).origin !== "https://rpc.refund.example") throw new Error("Unexpected network access");
  const request = JSON.parse(init?.body ?? await url.clone().text());
  const respond = ({ id, method, params }) => {
    let result;
    switch (method) {
      case "eth_chainId": result = "0x66eee"; break;
      case "eth_getTransactionCount": result = "0x11"; break;
      case "eth_estimateGas": result = "0x5208"; break;
      case "eth_maxPriorityFeePerGas": result = "0x5f5e100"; break;
      case "eth_gasPrice": result = "0x3b9aca00"; break;
      case "eth_blockNumber": result = "0x2"; break;
      case "eth_getBlockByNumber": result = { number:"0x2", hash:replacement.blockHash, baseFeePerGas:"0x3b9aca00", gasLimit:"0x1c9c380", gasUsed:"0x5208", timestamp:"0x1",
        transactions:scenario === "unknown" ? [] : params[1] ? [replacement] : [replacement.hash] }; break;
      case "eth_sendRawTransaction": if (++broadcasts > 1 && scenario !== "unknown") throw new Error("Unexpected rebroadcast"); result = original.hash; break;
      case "eth_getTransactionReceipt": result = scenario !== "unknown" && params[0] === replacement.hash ? receipt : null; break;
      case "eth_getTransactionByHash": result = scenario === "unknown" ? null : params[0] === original.hash ? original : replacement; break;
      default: throw new Error("Unexpected RPC method: " + method);
    }
    return { jsonrpc:"2.0", id, result };
  };
  return new Response(JSON.stringify(Array.isArray(request) ? request.map(respond) : respond(request)));
};
`);
      try {
        const r = await run(["claim-waitlist-refund", "--topic-id", "123", "--citizen-id", "42"], env, { preload });
        expect(r.status, r.stderr.slice(-4500)).toBe(scenario === "unknown" ? 2 : scenario === "repriced" ? 0 : 1);
        const lines = r.stderr.trim().split(/\r?\n/);
        expect(lines).toContain(`Transaction submitted: ${hash}`);
        if (scenario === "repriced") {
          expect(JSON.parse(r.stdout)).toMatchObject({ status: "success", txHash: replacementHash });
          expect(lines).toContain(`Transaction submitted: ${replacementHash}`);
        } else {
          expect(r.stdout).toBe("");
          if (scenario === "repriced-reverted") {
            expect(r.stderr).toContain(`Transaction reverted on-chain: ${replacementHash}`);
            expect(r.stderr).not.toContain("CHAIN_TRANSACTION_UNCERTAIN");
          } else {
            const errorStart = r.stderr.lastIndexOf("\n{");
            expect(errorStart).toBeGreaterThanOrEqual(0);
            const error = JSON.parse(r.stderr.slice(errorStart + 1));
            expect(error).toMatchObject({ ok: false, chain_id: 421614, transaction_nonce: 17,
              error: { next_action: "CHECK_TRANSACTION" } });
            expect(error).toMatchObject(scenario === "unknown"
              ? { terminal: false, tx_hash: hash, error: { code: "CHAIN_TRANSACTION_UNCERTAIN" } }
              : { terminal: true, original_tx_hash: hash, tx_hash: replacementHash, replacement_reason: scenario,
                  error: { code: "CHAIN_TRANSACTION_REPLACED" } });
          }
        }
        expect(r.stderr).not.toContain(env.ROBOTANIA_PRIVATE_KEY);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  });

  // ── missing private key ─────────────────────────────────────────────────────

  it("approve-bond without PRIVATE_KEY exits 1", async () => {
    const r = await run(
      ["approve-bond", "--dry-run"],
      {
        ROBOTANIA_PRIVATE_KEY: "",
        ROBOTANIA_DEPLOYED_ADDRESSES_PATH: resolve(__dirname, "fixtures/deployed-addresses.json"),
      },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ROBOTANIA_PRIVATE_KEY");
  });
});
