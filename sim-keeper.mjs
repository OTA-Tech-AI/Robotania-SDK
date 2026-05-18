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

const RPC_URL      = "http://104.168.122.108:8546";
const READ_API     = "http://104.168.122.108:3200";
const MATCH_MGR    = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";
const JURY_MANAGER = "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const JURY_IDS     = [2n, 3n, 4n];
const ZERO_HASH    = "0x0000000000000000000000000000000000000000000000000000000000000000";
// Only handle topics created after this sim started (ID > 26 = previous sims)
const MIN_TOPIC_ID = 26;
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
    const resp = await fetchJson(`${READ_API}/api/v1/public/topics?limit=30`);
    const topics = (resp.data || []).filter(t => parseInt(t.topic_id) > MIN_TOPIC_ID);

    for (const t of topics) {
      if (t.state === "ACTIVATED" && t.match_id && !startedMatches.has(t.match_id)) {
        try {
          const hash = await wc.writeContract({ account, address: MATCH_MGR, abi: matchAbi, functionName: "startMatch", args: [BigInt(t.match_id)] });
          await pub.waitForTransactionReceipt({ hash });
          startedMatches.add(t.match_id);
          console.log(`[keeper ${now()}] startMatch(${t.match_id}) topic#${t.topic_id} "${t.title || '?'}" ✓`);
        } catch (e) {
          startedMatches.add(t.match_id); // don't retry
          if (!e.message?.includes("revert")) console.log(`[keeper ${now()}] startMatch skip: ${e.message?.slice(0, 60)}`);
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
          // Extract jury case ID from JuryCaseCreated event logs (topic[0] signature, topic[2] = caseId)
          let juryCaseId = null;
          for (const log of receipt.logs) {
            if (log.topics.length >= 3) {
              try { juryCaseId = String(BigInt(log.topics[1])); } catch {}
              break;
            }
          }
          juryCasesByMatch.set(matchId, { juryCaseId, createdAt: Date.now() });
          console.log(`[keeper ${now()}] createJuryCase(match=${matchId}, jurors=[2,3,4]) juryCaseId=${juryCaseId} ✓`);
        }
      } catch (e) {
        // Mark as processed even on error to avoid infinite retry
        juryCasesByMatch.set(matchId, { juryCaseId: null, createdAt: Date.now() });
        if (!e.message?.includes("revert")) console.log(`[keeper ${now()}] jury skip match ${matchId}: ${e.message?.slice(0, 60)}`);
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
        for (const jurorId of JURY_IDS) {
          const existing = await pub.readContract({ address: JURY_MANAGER, abi: juryAbi, functionName: "getJuryRubricHash", args: [BigInt(juryCaseId), jurorId] });
          if (existing !== ZERO_HASH) continue;
          try {
            const h = await wc.writeContract({ account, address: JURY_MANAGER, abi: juryAbi, functionName: "submitJuryRubric", args: [BigInt(juryCaseId), jurorId, neutralHash] });
            await pub.waitForTransactionReceipt({ hash: h });
            submitted++;
            console.log(`[keeper ${now()}] rubric fallback: case ${juryCaseId} juror #${jurorId} ✓`);
          } catch (e) {
            if (!e.message?.includes("AlreadySubmitted") && !e.message?.includes("revert")) {
              console.log(`[keeper ${now()}] rubric fallback juror #${jurorId} skip: ${e.message?.slice(0, 60)}`);
            }
          }
        }

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
          if (!e.message?.includes("revert")) console.log(`[keeper ${now()}] finalize fallback skip: ${e.message?.slice(0, 60)}`);
          finalizedCases.add(juryCaseId); // don't retry
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
