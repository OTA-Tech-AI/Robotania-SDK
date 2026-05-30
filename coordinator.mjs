/**
 * Coordinator: monitors arena state, calls startMatch + createJuryCase
 * when conditions are met. Does NOT decide debate content — that's agents' job.
 */
import { createPublicClient, createWalletClient, http, defineChain, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC_URL     = "http://104.168.122.108:8546";
const READ_API    = "http://104.168.122.108:3200";
const MATCH_MGR   = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";
const JURY_MANAGER= "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";
const DEPLOYER_KEY= "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const chain = defineChain({id:31337,name:"Anvil",nativeCurrency:{name:"Ether",symbol:"ETH",decimals:18},rpcUrls:{default:{http:[RPC_URL]}}});
const account = privateKeyToAccount(DEPLOYER_KEY);
const pub = createPublicClient({ chain, transport: http(RPC_URL) });
const wc  = createWalletClient({ account, chain, transport: http(RPC_URL) });

const matchAbi = parseAbi(["function startMatch(uint256 matchId) external"]);
const juryAbi  = parseAbi([
  "function isJurorSelectionPending(uint256 matchId) external view returns (bool)",
  "function createJuryCase(uint256 matchId, uint256[] calldata jurorCitizenIds, bytes32 evidenceRoot) external returns (uint256)",
]);

const JURY_IDS = [2n, 3n, 4n];
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fetchJson = async url => { const r = await fetch(url); return r.json(); };

const startedMatches = new Set();
const juriedMatches  = new Set();
const results = { startedMatches: [], juryCases: [] };

console.log("[coordinator] starting — polling every 15s for up to 20min");

const deadline = Date.now() + 20 * 60_000;
while (Date.now() < deadline) {
  await sleep(15_000);
  const now = new Date().toISOString().slice(11,19);

  try {
    // 1. Find ACTIVATED topics that have match IDs — call startMatch
    const topicsResp = await fetchJson(`${READ_API}/api/v1/public/topics?limit=30`);
    const topics = topicsResp.data || [];
    for (const t of topics) {
      if (t.state === "ACTIVATED" && t.match_id && !startedMatches.has(t.match_id)) {
        try {
          const hash = await wc.writeContract({ account, address: MATCH_MGR, abi: matchAbi, functionName:"startMatch", args:[BigInt(t.match_id)] });
          await pub.waitForTransactionReceipt({ hash });
          startedMatches.add(t.match_id);
          results.startedMatches.push({ matchId: t.match_id, topicId: t.topic_id, topicTitle: t.title });
          console.log(`[${now}] startMatch(${t.match_id}) for topic #${t.topic_id} "${t.title}" ✓`);
        } catch(e) {
          if (!e.message.includes("already")) console.log(`[${now}] startMatch(${t.match_id}) skip: ${e.message.slice(0,80)}`);
          startedMatches.add(t.match_id); // don't retry
        }
      }
    }

    // 2. For all started matches, check isJurorSelectionPending → createJuryCase
    for (const matchId of startedMatches) {
      if (juriedMatches.has(matchId)) continue;
      try {
        const pending = await pub.readContract({ address: JURY_MANAGER, abi: juryAbi, functionName:"isJurorSelectionPending", args:[BigInt(matchId)] });
        if (pending) {
          const hash = await wc.writeContract({ account, address: JURY_MANAGER, abi: juryAbi, functionName:"createJuryCase", args:[BigInt(matchId), JURY_IDS, ZERO_HASH] });
          await pub.waitForTransactionReceipt({ hash });
          juriedMatches.add(matchId);
          results.juryCases.push({ matchId, jurors: [2, 3, 4] });
          console.log(`[${now}] createJuryCase(match=${matchId}, jurors=[2,3,4]) ✓`);
        }
      } catch(e) {
        console.log(`[${now}] jury check match ${matchId}: ${e.message.slice(0,80)}`);
        juriedMatches.add(matchId); // avoid hammering
      }
    }

    // 3. Report match states
    const stateLines = [];
    for (const matchId of startedMatches) {
      const mr = await fetchJson(`${READ_API}/api/v1/public/matches/${matchId}`);
      const m = mr.data || mr;
      stateLines.push(`match#${matchId}=${m.state}${m.settlement_winner?'('+m.settlement_winner+')':''}`);
    }
    if (stateLines.length) console.log(`[${now}] states: ${stateLines.join('  ')}`);

    // 4. Stop if all known matches are finalized
    const allFinalized = startedMatches.size > 0 && [...startedMatches].every(id => {
      return results.startedMatches.length > 0; // placeholder — check below
    });

    let allDone = startedMatches.size >= 2;
    for (const matchId of startedMatches) {
      const mr = await fetchJson(`${READ_API}/api/v1/public/matches/${matchId}`);
      const m = mr.data || mr;
      if (m.state !== "FINALIZED" && m.settlement_state !== "FINALIZED") { allDone = false; break; }
    }
    if (allDone && startedMatches.size >= 2) {
      console.log(`[${now}] ALL MATCHES FINALIZED — coordinator done`);
      break;
    }
  } catch(e) {
    console.log(`[coordinator] error: ${e.message.slice(0,120)}`);
  }
}

// Final: collect match results
const finalResults = [];
for (const matchId of startedMatches) {
  const mr = await fetchJson(`${READ_API}/api/v1/public/matches/${matchId}`);
  const m = mr.data || mr;
  finalResults.push({ matchId, topicId: m.topic_id, state: m.state, settlement_winner: m.settlement_winner, settlement_state: m.settlement_state });
}

console.log("FINAL_JSON:" + JSON.stringify({ startedMatches: [...startedMatches], juryCases: results.juryCases, matchResults: finalResults }));
