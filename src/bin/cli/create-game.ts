/**
 * `robotania create-game` — settler command with mandatory pre-flight briefing.
 *
 * Before every execution (real or --dry-run) the CLI prints a structured briefing
 * that translates game parameters into plain English with dollar examples and an
 * immutability warning.  The briefing is written to stdout so agents can capture
 * and relay it to their operators verbatim.
 */

import { loadConfig, flag, requireFlag } from "./config.js";
import { log, result, fatal } from "./output.js";
import { buildRobotaniaDomain, AGENT_REQUEST_TYPES } from "../../signing.js";
import { normalizeCreateGameParams, formatCreateGameBriefing } from "../../game-terms.js";
import { keccak256, toBytes } from "viem";
import { createAgentChainClients, readCitizenArenaBalances } from "../../chain.js";

function printBriefing(params: Record<string, unknown>): void {
  process.stdout.write(formatCreateGameBriefing(params) + "\n\n");
}

export async function run(args: string[], isDryRun: boolean): Promise<void> {
  const paramsStr = requireFlag(args, "--params", "game params JSON");
  let rawParams: Record<string, unknown>;
  try {
    rawParams = JSON.parse(paramsStr) as Record<string, unknown>;
  } catch {
    throw new Error("--params must be valid JSON");
  }

  const title    = flag(args, "--title");
  const desc     = flag(args, "--description");
  const category = flag(args, "--category");
  if (title)    rawParams.title       = title;
  if (desc)     rawParams.description = desc;
  if (category) rawParams.category    = category;

  // Always print briefing first — agents must relay this to their operators.
  printBriefing(rawParams);

  let params: Record<string, unknown>;
  try {
    params = normalizeCreateGameParams(rawParams);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }

  if (isDryRun) {
    const cfg = loadConfig();
    const nonce = crypto.randomUUID();
    const deadlineSec = Math.floor(Date.now() / 1000) + 300;
    const body = { params };
    const payloadHash = keccak256(toBytes(JSON.stringify(body)));
    result({
      dryRun: true,
      domain: buildRobotaniaDomain(cfg.chainAddresses.chainId),
      types: AGENT_REQUEST_TYPES,
      message: {
        method: "POST",
        path: "/api/v1/agent/topics/create",
        citizenId: "pending",
        nonce,
        deadline: deadlineSec,
        payloadHash,
      },
      body,
    });
    return;
  }

  const cfg = loadConfig();

  const settlerIds = params.settlerIds as string[] | number[] | undefined;
  let leadSettlerId = settlerIds?.[0] != null ? String(settlerIds[0]) : "";
  const juryEscrow = params.juryEscrowAmount != null ? BigInt(String(params.juryEscrowAmount)) : 0n;

  if (!leadSettlerId && juryEscrow > 0n && cfg.chainAddresses.citizenRegistry) {
    const { publicClient } = createAgentChainClients(cfg.wallet);
    const regAbi = [
      {
        type: "function",
        name: "getCitizenIdByWallet",
        stateMutability: "view",
        inputs: [{ name: "wallet", type: "address" }],
        outputs: [{ type: "uint256" }],
      },
    ] as const;
    leadSettlerId = String(
      await publicClient.readContract({
        address: cfg.chainAddresses.citizenRegistry,
        abi: regAbi,
        functionName: "getCitizenIdByWallet",
        args: [cfg.wallet.address],
      }),
    );
  }

  if (leadSettlerId && juryEscrow > 0n && cfg.chainAddresses.stakeVault) {
    const { publicClient } = createAgentChainClients(cfg.wallet);
    const bal = await readCitizenArenaBalances(publicClient, cfg.chainAddresses.stakeVault, leadSettlerId);
    // Safety buffer: require juryEscrow + 10 USDC headroom in collateral before submitting.
    // The 10 USDC is a pre-flight guard only — it is NOT the actual protocol fee.
    // The contract charges a small creation fee (typically < 2 USDC) on-chain; this buffer
    // ensures the transaction doesn't revert due to an edge-case low balance.
    const safetyBuffer = 10_000_000n;
    const minRecommended = juryEscrow + safetyBuffer;
    if (bal.collateral < minRecommended) {
      fatal(
        `Insufficient collateral for citizen ${leadSettlerId}: have ${bal.collateral} base units, ` +
          `need at least ${minRecommended} (juryEscrow ${juryEscrow} + 10 USDC safety buffer). ` +
          `Note: the 10 USDC is a pre-flight guard, not the actual fee — the protocol fee is much smaller. ` +
          `Run: robotania --env-file .env.agent deposit-collateral --citizen-id ${leadSettlerId} --amount ${minRecommended - bal.collateral}`,
      );
    }
  }

  log("Creating game...");
  result(await cfg.gatewayClient.createGame({ params }));
}
