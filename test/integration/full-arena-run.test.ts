/**
 * Comprehensive integration test: full arena lifecycle with jury settlement.
 *
 * Run with:
 *   ROBOTANIA_INTEGRATION=true pnpm vitest run test/integration/full-arena-run.test.ts
 *
 * Requires .env.integration.test and a live arena stack.
 * Fully automated — no human-in-loop steps.
 *
 * Flow:
 *   1. Settler (#56) creates a JURY_FIRST topic (3 planned turns)
 *   2. Competitor A (#55) and Competitor B (#57) join waitlist
 *   3. Settler activates → startMatch()
 *   4. Both competitors submit 3 turns each (interleaved)
 *   5. Turn timeout (90s) elapses → gateway worker marks timeout + escalates to jury
 *   6. Keeper directly creates jury case with test jurors (#2,#3,#4) — bypasses
 *      random commit-reveal so jurors are always those we control
 *   7. Verify 3 test jurors assigned
 *   8. All 3 jurors submit rubrics (scoring side A higher → A wins)
 *   9. Gateway auto-finalizes on 3rd rubric → match reaches SETTLED
 */

import { describe, it, expect, beforeAll } from "vitest";
import { config as loadDotenv } from "dotenv";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  parseAbi,
} from "viem";
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
const COMP_A_KEY     = process.env.INTEGRATION_COMPETITOR_KEY! as `0x${string}`;
const COMP_A_ID      = process.env.INTEGRATION_COMPETITOR_CITIZEN_ID!;
const COMP_B_KEY     = process.env.INTEGRATION_SUBAGENT_KEY!   as `0x${string}`;
const COMP_B_ID      = process.env.INTEGRATION_SUBAGENT_CITIZEN_ID!;

const JURY1_KEY      = process.env.INTEGRATION_JURY1_KEY!      as `0x${string}`;
const JURY1_ID       = process.env.INTEGRATION_JURY1_CITIZEN_ID!;
const JURY2_KEY      = process.env.INTEGRATION_JURY2_KEY!      as `0x${string}`;
const JURY2_ID       = process.env.INTEGRATION_JURY2_CITIZEN_ID!;
const JURY3_KEY      = process.env.INTEGRATION_JURY3_KEY!      as `0x${string}`;
const JURY3_ID       = process.env.INTEGRATION_JURY3_CITIZEN_ID!;

const DEPLOYER_KEY   = process.env.INTEGRATION_DEPLOYER_KEY!   as `0x${string}`;
const USDC_ADDR      = process.env.ROBOTANIA_SETTLEMENT_TOKEN! as `0x${string}`;
const STAKE_VAULT    = process.env.ROBOTANIA_STAKE_VAULT!       as `0x${string}`;
const MATCH_MANAGER  = process.env.ROBOTANIA_MATCH_MANAGER!     as `0x${string}`;
const JURY_MANAGER   = process.env.ROBOTANIA_JURY_MANAGER!      as `0x${string}`;

const BINARY = resolve(__dirname, "../../dist/bin/robotania.js");

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

// ── ABIs ──────────────────────────────────────────────────────────────────────

const stakeVaultAbi = parseAbi([
  "function collateralBalanceByCitizen(uint256) view returns (uint256)",
  "function depositCollateral(uint256, uint256)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
]);
const matchManagerAbi = parseAbi([
  "function startMatch(uint256 matchId)",
]);
const juryManagerAbi = parseAbi([
  // Keeper-direct path: bypass commit-reveal for testing (jurors deterministic)
  "function createJuryCase(uint256 matchId, uint256[] calldata jurorCitizenIds, bytes32 evidenceRoot) external returns (uint256)",
  "function isJurorSelectionPending(uint256 matchId) external view returns (bool)",
]);

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
    `ROBOTANIA_MATCH_MANAGER=${MATCH_MANAGER}`,
    "",
  ].join("\n");
}

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

async function poll<T>(
  fn: () => Promise<T | null | undefined>,
  timeoutMs: number,
  intervalMs = 4_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v !== null && v !== undefined) return v;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`poll timed out after ${timeoutMs}ms`);
}

async function waitForRequest(envFile: string, requestId: string): Promise<void> {
  const out = cli(envFile, "wait-request", "--request-id", requestId);
  if (out.status !== "FINALIZED") {
    throw new Error(`Request ${requestId}: status=${out.status} error=${out.error_message}`);
  }
}

async function ensureCollateral(citizenId: string, key: `0x${string}`, minAmount: bigint) {
  const current = await publicClient.readContract({
    address: STAKE_VAULT, abi: stakeVaultAbi,
    functionName: "collateralBalanceByCitizen", args: [BigInt(citizenId)],
  }) as bigint;
  if (current >= minAmount) return;
  const wc = walletClient(key);
  const account = privateKeyToAccount(key);
  const hash = await wc.writeContract({
    account, address: STAKE_VAULT, abi: stakeVaultAbi,
    functionName: "depositCollateral", args: [BigInt(citizenId), minAmount - current],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

async function ensureUsdc(address: `0x${string}`, minAmount: bigint) {
  const bal = await publicClient.readContract({
    address: USDC_ADDR, abi: erc20Abi, functionName: "balanceOf", args: [address],
  }) as bigint;
  if (bal >= minAmount) return;
  const wc = walletClient(DEPLOYER_KEY);
  const account = privateKeyToAccount(DEPLOYER_KEY);
  const hash = await wc.writeContract({
    account, address: USDC_ADDR, abi: erc20Abi,
    functionName: "transfer", args: [address, minAmount - bal],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

async function ensureUsdcApproval(key: `0x${string}`, spender: `0x${string}`) {
  const account = privateKeyToAccount(key);
  const allowance = await publicClient.readContract({
    address: USDC_ADDR, abi: erc20Abi,
    functionName: "allowance", args: [account.address, spender],
  }) as bigint;
  if (allowance > 0n) return;
  const wc = walletClient(key);
  const hash = await wc.writeContract({
    account, address: USDC_ADDR, abi: erc20Abi,
    functionName: "approve", args: [spender, 2n ** 256n - 1n],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Integration: full arena run with jury settlement", () => {
  if (!process.env.ROBOTANIA_INTEGRATION) {
    it.skip("set ROBOTANIA_INTEGRATION=true to run integration tests", () => {});
    return;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "robotania-arena-run-"));
  const settlerEnv  = join(tmpDir, "settler.env");
  const compAEnv    = join(tmpDir, "compA.env");
  const compBEnv    = join(tmpDir, "compB.env");
  const jury1Env    = join(tmpDir, "jury1.env");
  const jury2Env    = join(tmpDir, "jury2.env");
  const jury3Env    = join(tmpDir, "jury3.env");

  let topicId = "";
  let matchId = "";
  let juryCaseId = "";

  beforeAll(async () => {
    writeFileSync(settlerEnv, makeEnv(SETTLER_KEY), "utf8");
    writeFileSync(compAEnv,   makeEnv(COMP_A_KEY),  "utf8");
    writeFileSync(compBEnv,   makeEnv(COMP_B_KEY),  "utf8");
    writeFileSync(jury1Env,   makeEnv(JURY1_KEY),   "utf8");
    writeFileSync(jury2Env,   makeEnv(JURY2_KEY),   "utf8");
    writeFileSync(jury3Env,   makeEnv(JURY3_KEY),   "utf8");

    // Fund both competitors with USDC + collateral
    await Promise.all([
      (async () => {
        const addr = privateKeyToAccount(COMP_A_KEY).address;
        await ensureUsdc(addr, 10_000_000n);
        await ensureUsdcApproval(COMP_A_KEY, STAKE_VAULT);
        await ensureCollateral(COMP_A_ID, COMP_A_KEY, 5_000_000n);
      })(),
      (async () => {
        const addr = privateKeyToAccount(COMP_B_KEY).address;
        await ensureUsdc(addr, 10_000_000n);
        await ensureUsdcApproval(COMP_B_KEY, STAKE_VAULT);
        await ensureCollateral(COMP_B_ID, COMP_B_KEY, 5_000_000n);
      })(),
    ]);
  }, 60_000);

  // ── Step 1: Create topic ───────────────────────────────────────────────────

  it("settler (#56) creates a JURY_FIRST topic with 3 turns", async () => {
    const { data: existingTopics } = await fetchJson<{ data: { topic_id: string }[] }>(
      `/api/v1/public/topics?lead_settler_id=${SETTLER_ID}`,
    );
    const prevMaxId = existingTopics.length > 0
      ? Math.max(...existingTopics.map(t => Number(t.topic_id)))
      : 0;

    const params = {
      competitorCap: 2,
      minCompetitors: 2,
      plannedTurnCount: 3,
      minSpectatorDeposit: 5_000_000,
      activationStakeThreshold: 0,
      activationDeadline: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      salaryBudgetBps: 500,
      prizeBudgetBps: 3000,
      settlerShareBps: 500,
      juryRewardBps: 200,
      settlementMode: 1,
    };
    const out = cli(settlerEnv, "create-topic", "--params", JSON.stringify(params));
    expect(out.request_id).toMatch(/[0-9a-f-]{36}/);
    await waitForRequest(settlerEnv, out.request_id as string);

    topicId = await poll(async () => {
      const { data: topics } = await fetchJson<{ data: { topic_id: string }[] }>(
        `/api/v1/public/topics?lead_settler_id=${SETTLER_ID}`,
      );
      const fresh = topics
        .filter(t => Number(t.topic_id) > prevMaxId)
        .sort((a, b) => Number(b.topic_id) - Number(a.topic_id))[0];
      return fresh?.topic_id ?? null;
    }, 20_000);

    console.log(`\n✓ Topic #${topicId} created (JURY_FIRST, 3 turns)`);
  }, 45_000);

  // ── Step 2: Both competitors join ─────────────────────────────────────────

  it("both competitors join the waitlist", async () => {
    if (!topicId) throw new Error("topicId not set");

    const [outA, outB] = await Promise.all([
      Promise.resolve(cli(compAEnv, "join-waitlist", "--topic-id", topicId, "--citizen-id", COMP_A_ID)),
      Promise.resolve(cli(compBEnv, "join-waitlist", "--topic-id", topicId, "--citizen-id", COMP_B_ID)),
    ]);
    await Promise.all([
      waitForRequest(compAEnv, outA.request_id as string),
      waitForRequest(compBEnv, outB.request_id as string),
    ]);
    console.log(`✓ Citizens #${COMP_A_ID} and #${COMP_B_ID} joined topic #${topicId}`);
  }, 30_000);

  // ── Step 3: Activate + startMatch ─────────────────────────────────────────

  it("settler activates the topic and starts the match", async () => {
    if (!topicId) throw new Error("topicId not set");

    const out = cli(settlerEnv, "activate-topic", "--topic-id", topicId);
    await waitForRequest(settlerEnv, out.request_id as string);

    type TopicResp = { data: { match_id: string | null } };
    matchId = await poll(async () => {
      const { data } = await fetchJson<TopicResp>(`/api/v1/public/topics/${topicId}`);
      return data.match_id ?? null;
    }, 30_000);

    const wc = walletClient(DEPLOYER_KEY);
    const account = privateKeyToAccount(DEPLOYER_KEY);
    const startHash = await wc.writeContract({
      account, address: MATCH_MANAGER, abi: matchManagerAbi,
      functionName: "startMatch", args: [BigInt(matchId)],
    });
    await publicClient.waitForTransactionReceipt({ hash: startHash });

    console.log(`✓ Topic #${topicId} activated → match #${matchId} (LIVE)`);
  }, 60_000);

  // ── Steps 4a-4c: 3 turns each (interleaved) ───────────────────────────────

  for (const turnNum of [1, 2, 3] as const) {
    it(`both competitors submit turn ${turnNum}`, async () => {
      if (!matchId) throw new Error("matchId not set");

      const [outA, outB] = await Promise.all([
        Promise.resolve(cli(
          compAEnv, "submit-turn",
          "--match-id", matchId,
          "--citizen-id", COMP_A_ID,
          "--payload-content", JSON.stringify({ schemaVersion: 1, text: `Turn ${turnNum} from competitor A` }),
        )),
        Promise.resolve(cli(
          compBEnv, "submit-turn",
          "--match-id", matchId,
          "--citizen-id", COMP_B_ID,
          "--payload-content", JSON.stringify({ schemaVersion: 1, text: `Turn ${turnNum} from competitor B` }),
        )),
      ]);

      await Promise.all([
        waitForRequest(compAEnv, outA.request_id as string),
        waitForRequest(compBEnv, outB.request_id as string),
      ]);
      console.log(`✓ Turn ${turnNum} submitted by both competitors`);
    }, 30_000);
  }

  // ── Step 5: Wait for timeout → escalation ─────────────────────────────────

  it("match times out and escalates to jury (waits up to 3 min)", async () => {
    if (!matchId) throw new Error("matchId not set");

    // Poll until match state = UNDER_JURY_REVIEW
    type MatchResp = { data: { state: string } };
    await poll(async () => {
      const { data } = await fetchJson<MatchResp>(`/api/v1/public/matches/${matchId}`);
      return data.state === "UNDER_JURY_REVIEW" ? true : null;
    }, 3 * 60_000, 5_000);

    console.log(`✓ Match #${matchId} escalated to jury review`);
  }, 4 * 60_000);

  // ── Step 6: Keeper creates jury case with specific test jurors ────────────

  it("keeper creates jury case with test jurors #2,#3,#4 (deterministic selection)", async () => {
    if (!matchId) throw new Error("matchId not set");

    // Wait until juror selection is pending on-chain (set by submitJuryFirstEscalation → requestJurorSelection)
    const isPending = await poll(async () => {
      const pending = await publicClient.readContract({
        address: JURY_MANAGER, abi: juryManagerAbi,
        functionName: "isJurorSelectionPending", args: [BigInt(matchId)],
      }) as boolean;
      return pending ? true : null;
    }, 30_000, 2_000);
    expect(isPending).toBe(true);

    // Track the current jury case count before creating ours
    const { data: existingCases } = await fetchJson<{ data: { jury_case_id: string }[] }>(
      `/api/v1/public/jury-cases?match_id=${matchId}`,
    );
    const prevCaseCount = existingCases.length;

    // Keeper directly creates jury case with our 3 controlled test jurors
    // This bypasses the random commit-reveal so jurors are always deterministic
    const wc = walletClient(DEPLOYER_KEY); // deployer == keeper in test env
    const account = privateKeyToAccount(DEPLOYER_KEY);
    const hash = await wc.writeContract({
      account,
      address: JURY_MANAGER,
      abi: juryManagerAbi,
      functionName: "createJuryCase",
      args: [
        BigInt(matchId),
        [BigInt(JURY1_ID), BigInt(JURY2_ID), BigInt(JURY3_ID)],
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Poll until the indexer surfaces the new jury case
    const juryData = await poll(async () => {
      const { data } = await fetchJson<{ data: { jury_case_id: string }[] }>(
        `/api/v1/public/jury-cases?match_id=${matchId}`,
      );
      const newCases = data.filter(c => !existingCases.some(e => e.jury_case_id === c.jury_case_id));
      return newCases[0] ?? null;
    }, 30_000, 3_000);

    juryCaseId = juryData.jury_case_id;
    expect(juryCaseId).toBeTruthy();
    console.log(`✓ Jury case #${juryCaseId} created for match #${matchId} (jurors: ${JURY1_ID},${JURY2_ID},${JURY3_ID})`);
  }, 60_000);

  // ── Step 7: Verify 3 test jurors assigned ─────────────────────────────────

  it("jury case has exactly our 3 test jurors assigned", async () => {
    if (!juryCaseId) throw new Error("juryCaseId not set");

    type AssignmentsResp = { data: { juror_citizen_id: string }[] };
    const assignments = await poll(async () => {
      const { data } = await fetchJson<AssignmentsResp>(
        `/api/v1/public/jury-cases/${juryCaseId}/assignments`,
      );
      return data.length >= 3 ? data : null;
    }, 30_000, 3_000);

    const jurorIds = assignments.map(a => a.juror_citizen_id).sort();
    const expectedIds = [JURY1_ID, JURY2_ID, JURY3_ID].sort();
    console.log(`✓ Assigned jurors: ${jurorIds.join(", ")} (expected: ${expectedIds.join(", ")})`);
    expect(jurorIds).toEqual(expectedIds);
  }, 45_000);

  // ── Step 8: All 3 jurors submit rubrics (side A wins) ─────────────────────

  it("all 3 jurors submit rubrics scoring side A as winner", async () => {
    if (!juryCaseId) throw new Error("juryCaseId not set");

    // Rubric: side A scores higher across all criteria → A wins
    const rubric = {
      logic_consistency: { A: 9, B: 4 },
      evidence_quality: { A: 8, B: 3 },
      rebuttal_effectiveness: { A: 8, B: 5 },
      fallacy_count: { A: 0, B: 2 },
    };
    const rubricStr = JSON.stringify(rubric);

    const jurors = [
      { env: jury1Env, id: JURY1_ID },
      { env: jury2Env, id: JURY2_ID },
      { env: jury3Env, id: JURY3_ID },
    ];

    for (const { env, id } of jurors) {
      const out = cli(env, "submit-jury-rubric",
        "--jury-case-id", juryCaseId,
        "--juror-citizen-id", id,
        "--rubric", rubricStr,
      );
      await waitForRequest(env, out.request_id as string);
      console.log(`  ✓ Juror #${id} submitted rubric`);
    }
  }, 90_000);

  // ── Step 9: Settlement finalized ──────────────────────────────────────────

  it("settlement finalizes and match reaches SETTLED state", async () => {
    if (!matchId) throw new Error("matchId not set");

    type MatchResp = { data: { state: string; settlement_state: string | null; settlement_winner: number | null } };
    const result = await poll(async () => {
      const { data } = await fetchJson<MatchResp>(`/api/v1/public/matches/${matchId}`);
      if (data.settlement_state === "FINALIZED" || data.state === "SETTLED") return data;
      return null;
    }, 2 * 60_000, 4_000);

    console.log(`\n✅ Full arena run PASSED`);
    console.log(`   Match #${matchId}: state=${result.state} settlement=${result.settlement_state} winner_side=${result.settlement_winner}`);
    expect(result.settlement_state === "FINALIZED" || result.state === "SETTLED").toBe(true);
  }, 3 * 60_000);
});
