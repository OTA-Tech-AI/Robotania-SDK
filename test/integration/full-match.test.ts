/**
 * Optional end-to-end arena walkthrough with two automated wallets plus one **manual** competitor.
 *
 * Enable with:
 *   ROBOTANIA_INTEGRATION=true pnpm vitest run test/integration/full-match.test.ts
 *
 * Requires `.env.integration.test` with live arena URLs, RPC, and pre-seeded citizen IDs/keys.
 *
 * When a step needs a third wallet, the test prints the exact `robotania ...` line to run externally;
 * polling continues once the read API reflects that action.
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
/** Non-integration runs never touch chain; viem still needs a harmless default URL when env is empty. */
const RAW_RPC_URL  = process.env.ROBOTANIA_RPC_URL;
const RPC_URL      = RAW_RPC_URL && RAW_RPC_URL.trim() !== ""
  ? RAW_RPC_URL.trim()
  : "http://127.0.0.1:8545";
const CHAIN_ID     = Number(process.env.ROBOTANIA_CHAIN_ID ?? 31337);

const SETTLER_KEY    = process.env.INTEGRATION_SETTLER_KEY!    as `0x${string}`;
const SETTLER_ID     = process.env.INTEGRATION_SETTLER_CITIZEN_ID!;
const COMPETITOR_KEY = process.env.INTEGRATION_COMPETITOR_KEY! as `0x${string}`;
const COMPETITOR_ID  = process.env.INTEGRATION_COMPETITOR_CITIZEN_ID!;
/** Citizen ID whose commands are intentionally issued **outside** this test (human or separate agent). Prefer `INTEGRATION_THIRD_PARTY_CITIZEN_ID`; falls back to legacy `INTEGRATION_OPENCLAW_CITIZEN_ID`. */
const THIRD_PARTY_CITIZEN_ID =
  process.env.INTEGRATION_THIRD_PARTY_CITIZEN_ID ?? process.env.INTEGRATION_OPENCLAW_CITIZEN_ID ?? "54";
const DEPLOYER_KEY   = process.env.INTEGRATION_DEPLOYER_KEY!   as `0x${string}`;

const USDC_ADDR      = process.env.ROBOTANIA_SETTLEMENT_TOKEN! as `0x${string}`;
const STAKE_VAULT    = process.env.ROBOTANIA_STAKE_VAULT!       as `0x${string}`;
const MATCH_MANAGER  = process.env.ROBOTANIA_MATCH_MANAGER!     as `0x${string}`;
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
 * No stdin here — run the printed CLI in another terminal (or hand it to another agent) and the poll loop advances once state matches.
 */
async function waitForHuman<T>(
  instruction: string,
  pollFn: () => Promise<T | null | undefined>,
  timeoutMs = 10 * 60_000,
): Promise<T> {
  const line = "─".repeat(60);
  console.log(`\n${line}\n⏸  MANUAL CLI STEP\n   Run this where the third citizen’s key is loaded:\n\n   ${instruction}\n\n   (waiting up to ${Math.round(timeoutMs / 60_000)} min)\n${line}\n`);
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
const matchManagerAbi = parseAbi([
  "function startMatch(uint256 matchId)",
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

describe("Integration: full match plus manual third competitor", () => {
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
    if (!process.env.ROBOTANIA_RPC_URL?.trim()) {
      throw new Error("ROBOTANIA_INTEGRATION requires ROBOTANIA_RPC_URL (not empty)");
    }

    writeFileSync(settlerEnv,    makeEnv(SETTLER_KEY),    "utf8");
    writeFileSync(competitorEnv, makeEnv(COMPETITOR_KEY), "utf8");

    // Ensure competitor has USDC and collateral
    const competitorAddr = privateKeyToAccount(COMPETITOR_KEY).address;
    await ensureUsdc(competitorAddr, 5_000_000n);
    await ensureCollateral(COMPETITOR_ID, COMPETITOR_KEY, 5_000_000n);
  }, 60_000);

  // ── Step 1 ──────────────────────────────────────────────────────────────────

  it("settler creates a topic", async () => {
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
    // Record current highest topic_id before creating so we can detect the new one
    const { data: existingTopics } = await fetchJson<{ data: { topic_id: string }[] }>(
      `/api/v1/public/topics?lead_settler_id=${SETTLER_ID}`,
    );
    const prevMaxId = existingTopics.length > 0
      ? Math.max(...existingTopics.map(t => Number(t.topic_id)))
      : 0;

    const out = cli(settlerEnv, "create-topic", "--params", JSON.stringify(params));
    expect(out.request_id).toMatch(/[0-9a-f-]{36}/);
    await waitForRequest(settlerEnv, out.request_id as string);

    // Poll until the indexer surfaces the newly created topic (ID must exceed prevMaxId)
    topicId = await poll(async () => {
      const { data: topics } = await fetchJson<{ data: { topic_id: string }[] }>(
        `/api/v1/public/topics?lead_settler_id=${SETTLER_ID}`,
      );
      const fresh = topics
        .filter(t => Number(t.topic_id) > prevMaxId)
        .sort((a, b) => Number(b.topic_id) - Number(a.topic_id))[0];
      return fresh?.topic_id ?? null;
    }, 20_000);
    console.log(`\n✓ Topic #${topicId} created`);
  }, 30_000);

  // ── Step 2 ──────────────────────────────────────────────────────────────────

  it("primary competitor joins the topic", async () => {
    if (!topicId) throw new Error("topicId not set — did step 1 pass?");
    const out = cli(competitorEnv, "join-waitlist", "--topic-id", topicId, "--citizen-id", COMPETITOR_ID);
    await waitForRequest(competitorEnv, out.request_id as string);
    console.log(`✓ Citizen #${COMPETITOR_ID} joined topic #${topicId}`);
  }, 30_000);

  // ── Step 3 — human in loop ──────────────────────────────────────────────────

  it("manual third competitor joins (human or external agent)", async () => {
    if (!topicId) throw new Error("topicId not set — did step 1 pass?");
    type TopicResp = { data: { waitlist: { citizen_id: string }[] } };
    const joined = await waitForHuman(
      `robotania join-waitlist --topic-id ${topicId} --citizen-id ${THIRD_PARTY_CITIZEN_ID}`,
      async () => {
        const { data } = await fetchJson<TopicResp>(`/api/v1/public/topics/${topicId}`);
        return data.waitlist?.some(e => e.citizen_id === THIRD_PARTY_CITIZEN_ID) ? true : null;
      },
      12 * 60_000,
    );
    expect(joined).toBe(true);
    console.log(`✓ Third competitor (#${THIRD_PARTY_CITIZEN_ID}) joined topic #${topicId}`);
  }, 12 * 60_000);

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

    // activateTopic creates the match in PENDING_START; startMatch transitions it to LIVE.
    // startMatch is permissionless — anyone can call it directly on-chain.
    const wc = walletClient(DEPLOYER_KEY);
    const account = privateKeyToAccount(DEPLOYER_KEY);
    const startHash = await wc.writeContract({
      account,
      address: MATCH_MANAGER,
      abi: matchManagerAbi,
      functionName: "startMatch",
      args: [BigInt(matchId)],
    });
    await publicClient.waitForTransactionReceipt({ hash: startHash });

    console.log(`✓ Topic #${topicId} activated → match #${matchId} (LIVE)`);
  }, 60_000);

  // ── Step 5 — human in loop ──────────────────────────────────────────────────

  it("manual third competitor submits a turn [human/external agent]", async () => {
    if (!matchId) throw new Error("matchId not set — did step 4 pass?");
    const payloadContent = JSON.stringify({ schemaVersion: 1, text: "hello from third-party competitor" });
    type EntriesResp = { data: { actor_citizen_id: string }[] };
    const turn = await waitForHuman(
      `robotania submit-turn --match-id ${matchId} --citizen-id ${THIRD_PARTY_CITIZEN_ID} --payload-content '${payloadContent}'`,
      async () => {
        const { data } = await fetchJson<EntriesResp>(`/api/v1/public/matches/${matchId}/entries`);
        return data?.find(t => t.actor_citizen_id === THIRD_PARTY_CITIZEN_ID) ?? null;
      },
      12 * 60_000,
    );
    expect(turn).toBeTruthy();
    console.log(`✓ Third competitor submitted turn on match #${matchId}`);
  }, 12 * 60_000);

  // ── Step 6 ──────────────────────────────────────────────────────────────────

  it("primary competitor submits a turn", async () => {
    if (!matchId) throw new Error("matchId not set — did step 4 pass?");
    const out = cli(
      competitorEnv,
      "submit-turn",
      "--match-id", matchId,
      "--citizen-id", COMPETITOR_ID,
      "--payload-content", JSON.stringify({ schemaVersion: 1, text: "hello from test-competitor" }),
    );
    await waitForRequest(competitorEnv, out.request_id as string);
    console.log(`✓ Citizen #${COMPETITOR_ID} submitted turn on match #${matchId}`);
  }, 30_000);

  // ── Step 7 ──────────────────────────────────────────────────────────────────

  it("match has entries from both competitors", async () => {
    if (!matchId) throw new Error("matchId not set — did step 4 pass?");
    type EntriesResp = { data: { actor_citizen_id: string }[] };
    const { data: entries } = await fetchJson<EntriesResp>(`/api/v1/public/matches/${matchId}/entries`);
    const ids = entries.map(e => e.actor_citizen_id);
    expect(ids).toContain(THIRD_PARTY_CITIZEN_ID);
    expect(ids).toContain(COMPETITOR_ID);
    console.log(`\n✅ Integration test PASSED — match #${matchId} has entries from both automated and manual competitors`);
  }, 15_000);
});
