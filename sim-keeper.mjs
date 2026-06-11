/**
 * sim-keeper: persistent background service for arena simulation.
 * Handles privileged operations that agents cannot call:
 *   1. startMatch        — call after a topic is ACTIVATED
 *   2. createJuryCase    — call when isJurorSelectionPending, bypasses random commit-reveal
 *   3. rubric fallback   — after RUBRIC_TIMEOUT_MS, submit neutral rubrics for absent jurors
 *                          and finalize directly (prevents stuck UNDER_JURY_REVIEW matches)
 *
 * Runs forever until killed. Poll interval: 12s.
 */
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Required environment (no hardcoded defaults — keeper authority + endpoints must be explicit):
 *   ARENA_RPC_URL       — chain RPC, e.g. http://127.0.0.1:8545 for a local anvil
 *   ARENA_READ_API_URL  — public read API base, e.g. http://127.0.0.1:3200
 *   ARENA_DEPLOYER_KEY  — keeper private key (for a local anvil sim this is typically anvil dev key #0)
 * Optional:
 *   ARENA_MATCH_MANAGER / ARENA_JURY_MANAGER — contract addresses (defaults: deterministic local deploy)
 *   ARENA_MIN_TOPIC_ID  — only handle topics with ID > this value (default 0 = all topics)
 */
function requireEnv(name, hint) {
  const v = process.env[name];
  if (!v) {
    console.error(`[keeper] missing required env var ${name} (${hint})`);
    process.exit(1);
  }
  return v;
}

const RPC_URL      = requireEnv("ARENA_RPC_URL", "chain RPC URL, e.g. http://127.0.0.1:8545");
const READ_API     = requireEnv("ARENA_READ_API_URL", "read API base URL, e.g. http://127.0.0.1:3200");
const DEPLOYER_KEY = requireEnv("ARENA_DEPLOYER_KEY", "keeper private key; for local anvil sims use anvil dev key #0");
const MATCH_MGR    = process.env.ARENA_MATCH_MANAGER ?? "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";
const JURY_MANAGER = process.env.ARENA_JURY_MANAGER ?? "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";
const JURY_IDS     = [2n, 3n, 4n];
const ZERO_HASH    = "0x0000000000000000000000000000000000000000000000000000000000000000";
// Only handle topics with ID strictly greater than this (default 0 = all topics).
// Set ARENA_MIN_TOPIC_ID to skip topics left over from previous sim runs.
const MIN_TOPIC_ID = Number(process.env.ARENA_MIN_TOPIC_ID ?? 0);
// After this many ms without all rubrics, keeper submits neutral rubrics and finalizes
const RUBRIC_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const chain = defineChain({
  id: 31337, name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const account   = privateKeyToAccount(DEPLOYER_KEY);
const pub       = createPublicClient({ chain, transport: http(RPC_URL) });
const wc        = createWalletClient({ account, chain, transport: http(RPC_URL) });

const matchAbi  = parseAbi(["function startMatch(uint256 matchId) external"]);
const juryAbi   = parseAbi([
  "function isJurorSelectionPending(uint256 matchId) external view returns (bool)",
  "function createJuryCase(uint256 matchId, uint256[] calldata jurorCitizenIds, bytes32 evidenceRoot) external returns (uint256)",
  "function rubricCountByCase(uint256 juryCaseId) external view returns (uint256)",
  "function getJuryRubricHash(uint256 juryCaseId, uint256 jurorCitizenId) external view returns (bytes32)",
  "function submitJuryRubric(uint256 juryCaseId, uint256 jurorCitizenId, bytes32 rubricHash) external",
  "function finalizeJuryRubricCase(uint256 juryCaseId, uint8 outcome, bytes32 aggregatedRubricHash) external",
]);

const OUTCOME_A_WINS = 1;
const OUTCOME_B_WINS = 2;

// keccak256 of the event signature — topics[0] of JuryCaseCreated logs.
// event JuryCaseCreated(uint256 indexed juryCaseId, uint256 indexed matchId, bytes32 evidenceRoot)
const JURY_CASE_CREATED_TOPIC0 = keccak256(toBytes("JuryCaseCreated(uint256,uint256,bytes32)"));

/** Permanent on-chain failure (revert) vs transient (RPC blip, network) — transient ops are retried. */
const isRevert = e => Boolean(e?.message?.includes("revert"));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fetchJson = async url => { const r = await fetch(url); return r.json(); };
const now = () => new Date().toISOString().slice(11, 19);

const startedMatches = new Set();
// matchId → { juryCaseId, createdAt }
const juryCasesByMatch = new Map();
// juryCaseId set for cases that have been fully finalized
const finalizedCases  = new Set();

console.log(`[keeper ${now()}] started — watching topics > #${MIN_TOPIC_ID}`);

while (true) {
  await sleep(12_000);
  try {
    // 1. Find activated topics from this simulation → startMatch
    const resp = await fetchJson(`${READ_API}/api/v1/public/topics?page_size=30`);
    const topics = (resp.data || []).filter(t => parseInt(t.topic_id) > MIN_TOPIC_ID);

    for (const t of topics) {
      if (t.state === "ACTIVATED" && t.match_id && !startedMatches.has(t.match_id)) {
        try {
          const hash = await wc.writeContract({ account, address: MATCH_MGR, abi: matchAbi, functionName: "startMatch", args: [BigInt(t.match_id)] });
          await pub.waitForTransactionReceipt({ hash });
          startedMatches.add(t.match_id);
          console.log(`[keeper ${now()}] startMatch(${t.match_id}) topic#${t.topic_id} "${t.title || '?'}" ✓`);
        } catch (e) {
          if (isRevert(e)) {
            startedMatches.add(t.match_id); // permanent failure — don't retry
            console.log(`[keeper ${now()}] startMatch(${t.match_id}) reverted, won't retry: ${e.message?.slice(0, 80)}`);
          } else {
            console.log(`[keeper] transient error, will retry: startMatch(${t.match_id}) ${e.message?.slice(0, 80)}`);
          }
        }
      }
    }

    // 2. Check all known sim matches for pending jury selection → createJuryCase
    for (const matchId of startedMatches) {
      if (juryCasesByMatch.has(matchId)) continue;
      try {
        const pending = await pub.readContract({ address: JURY_MANAGER, abi: juryAbi, functionName: "isJurorSelectionPending", args: [BigInt(matchId)] });
        if (pending) {
          const hash = await wc.writeContract({ account, address: JURY_MANAGER, abi: juryAbi, functionName: "createJuryCase", args: [BigInt(matchId), JURY_IDS, ZERO_HASH] });
          const receipt = await pub.waitForTransactionReceipt({ hash });
          // Extract jury case ID from the JuryCaseCreated event log:
          // topics[0] = event signature, topics[1] = juryCaseId (indexed), topics[2] = matchId (indexed)
          let juryCaseId = null;
          for (const log of receipt.logs) {
            if (
              log.address?.toLowerCase() === JURY_MANAGER.toLowerCase() &&
              log.topics?.[0] === JURY_CASE_CREATED_TOPIC0 &&
              log.topics.length >= 3
            ) {
              try { juryCaseId = String(BigInt(log.topics[1])); } catch {}
              break;
            }
          }
          if (juryCaseId === null) {
            console.log(`[keeper ${now()}] warning: createJuryCase(match=${matchId}) succeeded but no JuryCaseCreated event found in receipt`);
          }
          juryCasesByMatch.set(matchId, { juryCaseId, createdAt: Date.now() });
          console.log(`[keeper ${now()}] createJuryCase(match=${matchId}, jurors=[2,3,4]) juryCaseId=${juryCaseId} ✓`);
        }
      } catch (e) {
        if (isRevert(e)) {
          // Permanent failure — mark as processed to avoid infinite retry
          juryCasesByMatch.set(matchId, { juryCaseId: null, createdAt: Date.now() });
          console.log(`[keeper ${now()}] createJuryCase(match=${matchId}) reverted, won't retry: ${e.message?.slice(0, 80)}`);
        } else {
          console.log(`[keeper] transient error, will retry: createJuryCase(match=${matchId}) ${e.message?.slice(0, 80)}`);
        }
      }
    }

    // 3. Rubric fallback: after RUBRIC_TIMEOUT_MS, submit neutral rubrics for absent jurors
    for (const [matchId, { juryCaseId, createdAt }] of juryCasesByMatch) {
      if (!juryCaseId || finalizedCases.has(juryCaseId)) continue;
      if (Date.now() - createdAt < RUBRIC_TIMEOUT_MS) continue;

      try {
        const rubricCount = await pub.readContract({ address: JURY_MANAGER, abi: juryAbi, functionName: "rubricCountByCase", args: [BigInt(juryCaseId)] });
        if (rubricCount >= 3n) { finalizedCases.add(juryCaseId); continue; }

        // Submit neutral rubric for each juror that hasn't submitted yet
        const neutralHash = keccak256(toBytes(`keeper-neutral-${juryCaseId}`));
        let submitted = 0;
        let transientFailures = 0;
        for (const jurorId of JURY_IDS) {
          const existing = await pub.readContract({ address: JURY_MANAGER, abi: juryAbi, functionName: "getJuryRubricHash", args: [BigInt(juryCaseId), jurorId] });
          if (existing !== ZERO_HASH) continue;
          try {
            const h = await wc.writeContract({ account, address: JURY_MANAGER, abi: juryAbi, functionName: "submitJuryRubric", args: [BigInt(juryCaseId), jurorId, neutralHash] });
            await pub.waitForTransactionReceipt({ hash: h });
            submitted++;
            console.log(`[keeper ${now()}] rubric fallback: case ${juryCaseId} juror #${jurorId} ✓`);
          } catch (e) {
            if (e.message?.includes("AlreadySubmitted") || isRevert(e)) {
              // permanent for this juror — nothing to retry
            } else {
              transientFailures++;
              console.log(`[keeper] transient error, will retry: submitJuryRubric(case=${juryCaseId}, juror=${jurorId}) ${e.message?.slice(0, 80)}`);
            }
          }
        }

        // Nothing submitted because of transient errors → retry next cycle, don't mark done
        if (submitted === 0 && transientFailures > 0) continue;
        if (submitted === 0) { finalizedCases.add(juryCaseId); continue; } // all done or case already finalized

        // Determine winner from read API rubric scores (use existing jurors' scores if available)
        let outcome = OUTCOME_A_WINS;
        try {
          const rubricData = await fetchJson(`${READ_API}/api/v1/public/jury-cases/${juryCaseId}/rubrics`);
          const agg = rubricData?.data?.aggregation;
          if (agg?.winner === "SIDE_B") outcome = OUTCOME_B_WINS;
        } catch {}

        // Call finalizeJuryRubricCase as keeper
        const aggHash = keccak256(toBytes(`keeper-agg-${juryCaseId}`));
        try {
          const h = await wc.writeContract({ account, address: JURY_MANAGER, abi: juryAbi, functionName: "finalizeJuryRubricCase", args: [BigInt(juryCaseId), outcome, aggHash] });
          await pub.waitForTransactionReceipt({ hash: h });
          finalizedCases.add(juryCaseId);
          const winner = outcome === OUTCOME_A_WINS ? "A_WINS" : "B_WINS";
          console.log(`[keeper ${now()}] finalizeJuryRubricCase(case=${juryCaseId}, outcome=${winner}) fallback ✓`);
        } catch (e) {
          if (isRevert(e)) {
            finalizedCases.add(juryCaseId); // permanent failure — don't retry
            console.log(`[keeper ${now()}] finalizeJuryRubricCase(case=${juryCaseId}) reverted, won't retry: ${e.message?.slice(0, 80)}`);
          } else {
            console.log(`[keeper] transient error, will retry: finalizeJuryRubricCase(case=${juryCaseId}) ${e.message?.slice(0, 80)}`);
          }
        }
      } catch (e) {
        if (!e.message?.includes("revert")) console.log(`[keeper ${now()}] rubric fallback error case ${juryCaseId}: ${e.message?.slice(0, 60)}`);
      }
    }

    // 4. Status line
    if (startedMatches.size > 0) {
      const states = await Promise.all([...startedMatches].map(async id => {
        try {
          const r = await fetchJson(`${READ_API}/api/v1/public/matches/${id}`);
          const m = r.data || r;
          return `#${id}:${m.state}${m.settlement_winner ? `(${m.settlement_winner})` : ""}`;
        } catch { return `#${id}:?`; }
      }));
      console.log(`[keeper ${now()}] ${states.join("  ")}`);
    }
  } catch (e) {
    console.log(`[keeper ${now()}] error: ${e.message?.slice(0, 100)}`);
  }
}
