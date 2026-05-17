/**
 * Integration test: full match flow with human-in-the-loop (OpenClaw).
 *
 * Run with:
 *   ROBOTANIA_INTEGRATION=true pnpm vitest run test/integration/full-match.test.ts
 *
 * Requires .env.integration.test (pre-registered settler #56 and competitor #55)
 * and a live arena stack.
 *
 * Human-in-the-loop steps are printed to console. The test polls the read API
 * automatically — no stdin interaction needed. Just send the printed command to
 * OpenClaw and the test continues when the action lands on-chain.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { config as loadDotenv } from "dotenv";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createPublicClient, createWalletClient, http, defineChain, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ── Config ────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, "../../.env.integration.test") });

const GATEWAY_URL  = process.env.ROBOTANIA_GATEWAY_URL!;
const READ_API_URL = process.env.ROBOTANIA_READ_API_URL!;
const RPC_URL      = process.env.ROBOTANIA_RPC_URL!;
const CHAIN_ID     = Number(process.env.ROBOTANIA_CHAIN_ID ?? 31337);

const SETTLER_KEY    = process.env.INTEGRATION_SETTLER_KEY!    as `0x${string}`;
const SETTLER_ID     = process.env.INTEGRATION_SETTLER_CITIZEN_ID!;
const COMPETITOR_KEY = process.env.INTEGRATION_COMPETITOR_KEY! as `0x${string}`;
const COMPETITOR_ID  = process.env.INTEGRATION_COMPETITOR_CITIZEN_ID!;
const OPENCLAW_ID    = process.env.INTEGRATION_OPENCLAW_CITIZEN_ID ?? "54";
const DEPLOYER_KEY   = process.env.INTEGRATION_DEPLOYER_KEY!   as `0x${string}`;

const USDC_ADDR      = process.env.ROBOTANIA_SETTLEMENT_TOKEN! as `0x${string}`;
const STAKE_VAULT    = process.env.ROBOTANIA_STAKE_VAULT!       as `0x${string}`;
const BINARY         = resolve(__dirname, "../../dist/bin/robotania.js");

// ── Chain clients ─────────────────────────────────────────────────────────────

const chain = defineChain({
  id: CHAIN_ID,
  name: "Robotania",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

function walletClient(key: `0x${string}`) {
  return createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(RPC_URL) });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEnv(privateKey: string): string {
  return [
    `ROBOTANIA_PRIVATE_KEY=${privateKey}`,
    `ROBOTANIA_GATEWAY_URL=${GATEWAY_URL}`,
    `ROBOTANIA_READ_API_URL=${READ_API_URL}`,
    `ROBOTANIA_RPC_URL=${RPC_URL}`,
    `ROBOTANIA_CHAIN_ID=${CHAIN_ID}`,
    `ROBOTANIA_PROTOCOL_CONFIG=${process.env.ROBOTANIA_PROTOCOL_CONFIG}`,
    `ROBOTANIA_CITIZEN_REGISTRY=${process.env.ROBOTANIA_CITIZEN_REGISTRY}`,
    `ROBOTANIA_SETTLEMENT_TOKEN=${USDC_ADDR}`,
    `ROBOTANIA_STAKE_VAULT=${STAKE_VAULT}`,
    `ROBOTANIA_TOPIC_WAITLIST=${process.env.ROBOTANIA_TOPIC_WAITLIST}`,
    `ROBOTANIA_POSITION_POOL=${process.env.ROBOTANIA_POSITION_POOL}`,
    "",
  ].join("\n");
}

/** Run robotania CLI, return parsed JSON stdout. Throws on non-zero exit. */
function cli(envFile: string, ...args: string[]): Record<string, unknown> {
  const r = spawnSync(process.execPath, [BINARY, "--env-file", envFile, ...args], {
    encoding: "utf8", timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`CLI [${args.join(" ")}] failed:\n${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout) as Record<string, unknown>;
}

async function fetchJson<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${READ_API_URL}${path}`);
  return res.json() as Promise<T>;
}

/** Poll `fn` every intervalMs until it returns non-null/undefined, or throw on timeout. */
async function poll<T>(fn: () => Promise<T | null | undefined>, timeoutMs: number, intervalMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v !== null && v !== undefined) return v;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error("poll timed out");
}

/**
 * Print human instruction to console, then poll until on-chain state matches.
 * No stdin required — the human sends the printed command to OpenClaw.
 */
async function waitForHuman<T>(
  instruction: string,
  pollFn: () => Promise<T | null | undefined>,
  timeoutMs = 5 * 60_000,
): Promise<T> {
  const line = "─".repeat(60);
  console.log(`\n${line}\n⏸  HUMAN ACTION REQUIRED\n   Tell OpenClaw to run:\n\n   ${instruction}\n\n   (waiting up to ${Math.round(timeoutMs / 60_000)} min)\n${line}\n`);
  return poll(pollFn, timeoutMs);
}

async function waitForRequest(envFile: string, requestId: string): Promise<void> {
  const out = cli(envFile, "wait-request", "--request-id", requestId);
  if (out.status !== "FINALIZED") throw new Error(`Request ${requestId}: status=${out.status} error=${out.error_message}`);
}

const stakeVaultAbi = parseAbi([
  "function collateralBalanceByCitizen(uint256) view returns (uint256)",
  "function depositCollateral(uint256, uint256)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
]);

async function ensureCollateral(citizenId: string, key: `0x${string}`, minAmount: bigint) {
  const current = await publicClient.readContract({ address: STAKE_VAULT, abi: stakeVaultAbi, functionName: "collateralBalanceByCitizen", args: [BigInt(citizenId)] }) as bigint;
  if (current >= minAmount) return;
  const wc = walletClient(key);
  const account = privateKeyToAccount(key);
  const hash = await wc.writeContract({ account, address: STAKE_VAULT, abi: stakeVaultAbi, functionName: "depositCollateral", args: [BigInt(citizenId), minAmount - current] });
  await publicClient.waitForTransactionReceipt({ hash });
}

async function ensureUsdc(address: `0x${string}`, minAmount: bigint) {
  const bal = await publicClient.readContract({ address: USDC_ADDR, abi: erc20Abi, functionName: "balanceOf", args: [address] }) as bigint;
  if (bal >= minAmount) return;
  const wc = walletClient(DEPLOYER_KEY);
  const account = privateKeyToAccount(DEPLOYER_KEY);
  const hash = await wc.writeContract({ account, address: USDC_ADDR, abi: erc20Abi, functionName: "transfer", args: [address, minAmount - bal] });
  await publicClient.waitForTransactionReceipt({ hash });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Integration: full match with OpenClaw", () => {
  if (!process.env.ROBOTANIA_INTEGRATION) {
    it.skip("set ROBOTANIA_INTEGRATION=true to run integration tests", () => {});
    return;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "robotania-integration-"));
  const settlerEnv    = join(tmpDir, "settler.env");
  const competitorEnv = join(tmpDir, "competitor.env");

  // Shared across tests
  let topicId = "";
  let matchId = "";

  beforeAll(async () => {
    writeFileSync(settlerEnv,    makeEnv(SETTLER_KEY),    "utf8");
    writeFileSync(competitorEnv, makeEnv(COMPETITOR_KEY), "utf8");

    // Ensure competitor has USDC and collateral
    const competitorAddr = privateKeyToAccount(COMPETITOR_KEY).address;
    await ensureUsdc(competitorAddr, 5_000_000n);
    await ensureCollateral(COMPETITOR_ID, COMPETITOR_KEY, 5_000_000n);
  }, 60_000);

  // ── Step 1 ──────────────────────────────────────────────────────────────────

  it("settler (#56) creates a topic", async () => {
    const params = {
      competitorCap: 2,
      minCompetitors: 2,
      plannedTurnCount: 3,
      minSpectatorDeposit: 5_000_000,        // 5 USDC (protocol floor = minPositionAmount)
      activationStakeThreshold: 0,            // no spectator threshold required
      activationDeadline: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      salaryBudgetBps: 500,
      prizeBudgetBps: 3000,
      settlerShareBps: 500,
      juryRewardBps: 200,
      settlementMode: 1,                      // 1 = JURY_FIRST (gateway rejects string form)
    };
    const out = cli(settlerEnv, "create-topic", "--params", JSON.stringify(params));
    expect(out.request_id).toMatch(/[0-9a-f-]{36}/);
    await waitForRequest(settlerEnv, out.request_id as string);

    // Find the newly created topic via settler filter (list endpoint supports ?lead_settler_id=)
    const { data: topics } = await fetchJson<{ data: { topic_id: string }[] }>(
      `/api/v1/public/topics?lead_settler_id=${SETTLER_ID}`,
    );
    const mine = topics.sort((a, b) => Number(b.topic_id) - Number(a.topic_id))[0];
    expect(mine).toBeTruthy();
    topicId = mine.topic_id;
    console.log(`\n✓ Topic #${topicId} created`);
  }, 30_000);

  // ── Step 2 ──────────────────────────────────────────────────────────────────

  it("test competitor (#55) joins the topic", async () => {
    if (!topicId) throw new Error("topicId not set — did step 1 pass?");
    const out = cli(competitorEnv, "join-waitlist", "--topic-id", topicId, "--citizen-id", COMPETITOR_ID);
    await waitForRequest(competitorEnv, out.request_id as string);
    console.log(`✓ Citizen #${COMPETITOR_ID} joined topic #${topicId}`);
  }, 30_000);

  // ── Step 3 — human in loop ──────────────────────────────────────────────────

  it("OpenClaw (#54) joins the topic [human in loop]", async () => {
    if (!topicId) throw new Error("topicId not set — did step 1 pass?");
    type TopicResp = { data: { waitlist: { citizen_id: string }[] } };
    const joined = await waitForHuman(
      `robotania join-waitlist --topic-id ${topicId} --citizen-id ${OPENCLAW_ID}`,
      async () => {
        const { data } = await fetchJson<TopicResp>(`/api/v1/public/topics/${topicId}`);
        return data.waitlist?.some(e => e.citizen_id === OPENCLAW_ID) ? true : null;
      },
    );
    expect(joined).toBe(true);
    console.log(`✓ OpenClaw (#${OPENCLAW_ID}) joined topic #${topicId}`);
  }, 6 * 60_000);

  // ── Step 4 ──────────────────────────────────────────────────────────────────

  it("settler activates the topic", async () => {
    if (!topicId) throw new Error("topicId not set — did step 1 pass?");
    const out = cli(settlerEnv, "activate-topic", "--topic-id", topicId);
    await waitForRequest(settlerEnv, out.request_id as string);

    type TopicResp = { data: { match_id: string | null } };
    matchId = await poll(async () => {
      const { data } = await fetchJson<TopicResp>(`/api/v1/public/topics/${topicId}`);
      return data.match_id ?? null;
    }, 30_000);

    console.log(`✓ Topic #${topicId} activated → match #${matchId}`);
  }, 60_000);

  // ── Step 5 — human in loop ──────────────────────────────────────────────────

  it("OpenClaw submits a turn [human in loop]", async () => {
    if (!matchId) throw new Error("matchId not set — did step 4 pass?");
    const payload = JSON.stringify({ move: "hello from OpenClaw" });
    type TurnsResp = { data: { citizen_id: string }[] };
    const turn = await waitForHuman(
      `robotania submit-turn --match-id ${matchId} --citizen-id ${OPENCLAW_ID} --payload '${payload}'`,
      async () => {
        const { data } = await fetchJson<TurnsResp>(`/api/v1/public/matches/${matchId}/turns`);
        return data?.find(t => t.citizen_id === OPENCLAW_ID) ?? null;
      },
    );
    expect(turn).toBeTruthy();
    console.log(`✓ OpenClaw submitted turn on match #${matchId}`);
  }, 6 * 60_000);

  // ── Step 6 ──────────────────────────────────────────────────────────────────

  it("test competitor submits a turn", async () => {
    if (!matchId) throw new Error("matchId not set — did step 4 pass?");
    const out = cli(
      competitorEnv,
      "submit-turn",
      "--match-id", matchId,
      "--citizen-id", COMPETITOR_ID,
      "--payload", JSON.stringify({ move: "hello from test-competitor" }),
    );
    await waitForRequest(competitorEnv, out.request_id as string);
    console.log(`✓ Citizen #${COMPETITOR_ID} submitted turn on match #${matchId}`);
  }, 30_000);

  // ── Step 7 ──────────────────────────────────────────────────────────────────

  it("match has turns from both competitors", async () => {
    if (!matchId) throw new Error("matchId not set — did step 4 pass?");
    type TurnsResp = { data: { citizen_id: string }[] };
    const { data: turns } = await fetchJson<TurnsResp>(`/api/v1/public/matches/${matchId}/turns`);
    const ids = turns.map(t => t.citizen_id);
    expect(ids).toContain(OPENCLAW_ID);
    expect(ids).toContain(COMPETITOR_ID);
    console.log(`\n✅ Integration test PASSED — match #${matchId} has turns from OpenClaw and test-competitor`);
  }, 15_000);
});
