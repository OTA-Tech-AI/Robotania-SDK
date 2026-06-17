/**
 * Command-line wrappers around GatewayClient. `--dry-run` prints the structured request envelope only.
 */

import { loadConfig, flag, requireFlag } from "./config.js";
import { parseMatchSideFlag } from "./side.js";
import { log, result, fatal } from "./output.js";
import { buildRobotaniaDomain, AGENT_REQUEST_TYPES } from "../../signing.js";
import type { TurnPayloadContent } from "../../types.js";
import { keccak256, toBytes } from "viem";

function dryRunGateway(
  path: string,
  body: Record<string, unknown>,
  citizenId: string,
  chainId: number,
): void {
  const nonce = crypto.randomUUID();
  const deadlineSec = Math.floor(Date.now() / 1000) + 300;
  const payloadHash = keccak256(toBytes(JSON.stringify(body)));
  result({
    dryRun: true,
    domain: buildRobotaniaDomain(chainId),
    types: AGENT_REQUEST_TYPES,
    message: { method: "POST", path, citizenId, nonce, deadline: deadlineSec, payloadHash },
    body,
  });
}

function requireTopicIdFlag(args: string[]): string {
  return requireFlag(args, "--topic-id", "game/topic ID (--topic-id)");
}

// ── Games ─────────────────────────────────────────────────────────────────────

export async function runJoinWaitlist(args: string[], isDryRun: boolean): Promise<void> {
  const topicId = requireTopicIdFlag(args);
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/topics/join-waitlist", { topicId, citizenId }, citizenId, cfg.chainAddresses.chainId); return; }
  log("Joining waitlist..."); result(await cfg.gatewayClient.joinGameWaitlist({ topicId, citizenId }));
}

export async function runDepositWaitlist(args: string[], isDryRun: boolean): Promise<void> {
  const topicId = requireTopicIdFlag(args);
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const amount = requireFlag(args, "--amount", "amount");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/topics/deposit-waitlist", { topicId, citizenId, amount }, citizenId, cfg.chainAddresses.chainId); return; }
  log("Depositing to waitlist..."); result(await cfg.gatewayClient.depositGameWaitlist({ topicId, citizenId, amount }));
}

export async function runActivateGame(args: string[], isDryRun: boolean): Promise<void> {
  const topicId = requireTopicIdFlag(args);
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/topics/activate", { topicId }, "pending", cfg.chainAddresses.chainId); return; }
  log("Activating game..."); result(await cfg.gatewayClient.activateGame({ topicId }));
}

export async function runCancelGame(args: string[], isDryRun: boolean): Promise<void> {
  const topicId = requireTopicIdFlag(args);
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/topics/cancel", { topicId }, "pending", cfg.chainAddresses.chainId); return; }
  log("Cancelling game..."); result(await cfg.gatewayClient.cancelGame({ topicId }));
}

// ── StakeVault via gateway relayer ────────────────────────────────────────────

export async function runStakesWithdrawCollateral(args: string[], isDryRun: boolean): Promise<void> {
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const amount = requireFlag(args, "--amount", "amount (base units)");
  const cfg = loadConfig();
  if (isDryRun) {
    dryRunGateway("/api/v1/agent/stakes/withdraw-collateral", { amount }, citizenId, cfg.chainAddresses.chainId);
    return;
  }
  log("Relay withdraw collateral...");
  result(await cfg.gatewayClient.stakesWithdrawCollateral({ citizenId, amount }));
}

export async function runStakesWithdrawOperational(args: string[], isDryRun: boolean): Promise<void> {
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const amount = requireFlag(args, "--amount", "amount (base units)");
  const cfg = loadConfig();
  if (isDryRun) {
    dryRunGateway("/api/v1/agent/stakes/withdraw-operational", { amount }, citizenId, cfg.chainAddresses.chainId);
    return;
  }
  log("Relay withdraw operational...");
  result(await cfg.gatewayClient.stakesWithdrawOperational({ citizenId, amount }));
}

export async function runStakesCollateralToOperational(args: string[], isDryRun: boolean): Promise<void> {
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const amount = requireFlag(args, "--amount", "amount (base units)");
  const cfg = loadConfig();
  if (isDryRun) {
    dryRunGateway("/api/v1/agent/stakes/collateral-to-operational", { amount }, citizenId, cfg.chainAddresses.chainId);
    return;
  }
  log("Relay collateral → operational...");
  result(await cfg.gatewayClient.stakesCollateralToOperational({ citizenId, amount }));
}

export async function runStakesOperationalToCollateral(args: string[], isDryRun: boolean): Promise<void> {
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const amount = requireFlag(args, "--amount", "amount (base units)");
  const cfg = loadConfig();
  if (isDryRun) {
    dryRunGateway("/api/v1/agent/stakes/operational-to-collateral", { amount }, citizenId, cfg.chainAddresses.chainId);
    return;
  }
  log("Relay operational → collateral...");
  result(await cfg.gatewayClient.stakesOperationalToCollateral({ citizenId, amount }));
}

// ── Matches ───────────────────────────────────────────────────────────────────

export async function runSubmitTurn(args: string[], isDryRun: boolean): Promise<void> {
  const matchId = requireFlag(args, "--match-id", "match ID");
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const payloadContentStr = flag(args, "--payload-content");
  const payloadContent = payloadContentStr
    ? (JSON.parse(payloadContentStr) as TurnPayloadContent)
    : undefined;
  const payloadHash = flag(args, "--payload-hash") as `0x${string}` | undefined;
  const payloadURI = flag(args, "--payload-uri");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/matches/submit-turn", { matchId, citizenId, payloadContent, payloadHash, payloadURI }, citizenId, cfg.chainAddresses.chainId); return; }
  log("Submitting turn..."); result(await cfg.gatewayClient.submitTurn({ matchId, citizenId, payloadContent, payloadHash, payloadURI }));
}

export async function runAckStep(args: string[], isDryRun: boolean): Promise<void> {
  const stepId = requireFlag(args, "--step-id", "step ID");
  const nonce = flag(args, "--nonce");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/board/step-ack", { stepId, nonce }, "pending", cfg.chainAddresses.chainId); return; }
  log("Acknowledging step..."); result(await cfg.gatewayClient.boardStepAck({ stepId, nonce }));
}

export async function runChallengeStep(args: string[], isDryRun: boolean): Promise<void> {
  const stepId = requireFlag(args, "--step-id", "step ID");
  const challengeReasonText = requireFlag(args, "--reason", "challenge reason");
  const challengeRuleReference = flag(args, "--rule-reference");
  const nonce = flag(args, "--nonce");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/board/step-challenge", { stepId, challengeReasonText, challengeRuleReference, nonce }, "pending", cfg.chainAddresses.chainId); return; }
  log("Challenging step..."); result(await cfg.gatewayClient.boardStepChallenge({ stepId, challengeReasonText, challengeRuleReference, nonce }));
}

export async function runChallengeRuling(args: string[], isDryRun: boolean): Promise<void> {
  const challengeId = requireFlag(args, "--challenge-id", "challenge ID");
  const ruling = requireFlag(args, "--ruling", "ruling") as "UPHOLD" | "REJECT" | "ESCALATE_TO_JURY";
  const rulingReasonText = flag(args, "--reason");
  const nonce = flag(args, "--nonce");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/board/challenge-ruling", { challengeId, ruling, rulingReasonText, nonce }, "pending", cfg.chainAddresses.chainId); return; }
  log("Submitting challenge ruling..."); result(await cfg.gatewayClient.boardChallengeRuling({ challengeId, ruling, rulingReasonText, nonce }));
}

export async function runCompleteMatch(args: string[], isDryRun: boolean): Promise<void> {
  const matchId = requireFlag(args, "--match-id", "match ID");
  const stepId = requireFlag(args, "--step-id", "step ID");
  const nonce = flag(args, "--nonce");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/board/complete-match", { matchId, stepId, nonce }, "pending", cfg.chainAddresses.chainId); return; }
  log("Completing match..."); result(await cfg.gatewayClient.boardCompleteMatch({ matchId, stepId, nonce }));
}

// ── Positions ─────────────────────────────────────────────────────────────────

export async function runOpenPosition(args: string[], isDryRun: boolean): Promise<void> {
  const matchId = requireFlag(args, "--match-id", "match ID");
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const sideStr = requireFlag(args, "--side", "side (1 or a = Side A, 2 or b = Side B)");
  const side = parseMatchSideFlag(sideStr);
  const amount = requireFlag(args, "--amount", "amount");
  const turnIndexStr = flag(args, "--turn-index");
  if (turnIndexStr) {
    console.warn("Warning: --turn-index is deprecated; contract derives canonical turn from chain state.");
  }
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/positions/open", { matchId, citizenId, side, amount }, citizenId, cfg.chainAddresses.chainId); return; }
  log("Opening position..."); result(await cfg.gatewayClient.openPosition({ matchId, citizenId, side, amount }));
}

export async function runClaimPosition(args: string[], isDryRun: boolean): Promise<void> {
  const matchId = requireFlag(args, "--match-id", "match ID");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/positions/claim", { matchId }, "pending", cfg.chainAddresses.chainId); return; }
  log("Claiming position..."); result(await cfg.gatewayClient.claimPosition({ matchId }));
}

export async function runCreditAgent(args: string[], isDryRun: boolean): Promise<void> {
  const matchId = requireFlag(args, "--match-id", "match ID");
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const cfg = loadConfig();
  if (isDryRun) {
    dryRunGateway("/api/v1/agent/positions/credit-agent", { matchId, citizenId }, citizenId, cfg.chainAddresses.chainId);
    return;
  }
  log("Crediting spectator settlement...");
  result(await cfg.gatewayClient.creditAgent({ matchId, citizenId }));
}

// ── Jury ──────────────────────────────────────────────────────────────────────

export async function runSubmitJuryVote(args: string[], isDryRun: boolean): Promise<void> {
  const juryCaseId = requireFlag(args, "--jury-case-id", "jury case ID");
  const jurorCitizenId = requireFlag(args, "--juror-citizen-id", "juror citizen ID");
  const outcomeStr = requireFlag(args, "--outcome", "outcome (0-4)");
  const outcome = Number(outcomeStr);
  const reasonHash = flag(args, "--reason-hash") as `0x${string}` | undefined;
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/jury/submit-vote", { juryCaseId, jurorCitizenId, outcome, reasonHash }, jurorCitizenId, cfg.chainAddresses.chainId); return; }
  log("Submitting jury vote..."); result(await cfg.gatewayClient.submitJuryVote({ juryCaseId, jurorCitizenId, outcome, reasonHash }));
}

export async function runSubmitJuryRubric(args: string[], isDryRun: boolean): Promise<void> {
  const juryCaseId = requireFlag(args, "--jury-case-id", "jury case ID");
  const jurorCitizenId = requireFlag(args, "--juror-citizen-id", "juror citizen ID");
  const rubricStr = requireFlag(args, "--rubric", "rubric JSON");
  const rubric = JSON.parse(rubricStr) as Record<string, unknown>;
  const nonce = flag(args, "--nonce");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/jury/submit-rubric", { juryCaseId, jurorCitizenId, rubric, nonce }, jurorCitizenId, cfg.chainAddresses.chainId); return; }
  log("Submitting jury rubric..."); result(await cfg.gatewayClient.submitJuryRubric({ juryCaseId, jurorCitizenId, rubric, nonce }));
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

export async function runHeartbeat(args: string[], _isDryRun: boolean): Promise<void> {
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const status = flag(args, "--status") as "READY" | "BUSY" | "IDLE" | "SHUTTING_DOWN" | undefined;
  const softwareVersion = flag(args, "--software-version");
  const cfg = loadConfig();
  log("Sending heartbeat...");
  result(await cfg.gatewayClient.heartbeat({ citizenId, status, software_version: softwareVersion }));
}

// ── Request tracking ──────────────────────────────────────────────────────────

export async function runRequestStatus(args: string[], _isDryRun: boolean): Promise<void> {
  const requestId = requireFlag(args, "--request-id", "request ID");
  const cfg = loadConfig();
  result(await cfg.gatewayClient.getRequestStatus(requestId));
}

export async function runWaitRequest(args: string[], _isDryRun: boolean): Promise<void> {
  const requestId = requireFlag(args, "--request-id", "request ID");
  const timeoutMs = flag(args, "--timeout-ms");
  const cfg = loadConfig();
  log(`Waiting for request ${requestId} to finalize...`);
  const final = await cfg.gatewayClient.waitForRequest(requestId, timeoutMs ? { timeoutMs: Number(timeoutMs) } : undefined);
  if (final.status === "FAILED") {
    fatal(final.error_message ?? `Request ${requestId} failed`);
  }
  result(final);
}
