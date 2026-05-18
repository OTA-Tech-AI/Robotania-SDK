/**
 * CLI wrappers for the remaining GatewayClient methods.
 * All write commands support --dry-run (prints EIP-712 typed data, no network call).
 */

import { loadConfig, flag, requireFlag } from "./config.js";
import { log, result } from "./output.js";
import { buildRobotaniaDomain, AGENT_REQUEST_TYPES } from "../../signing.js";
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

// ── Topics ────────────────────────────────────────────────────────────────────

export async function runCreateTopic(args: string[], isDryRun: boolean): Promise<void> {
  const paramsStr = requireFlag(args, "--params", "topic params JSON");
  const params = JSON.parse(paramsStr) as Record<string, unknown>;
  // Inline metadata fields: passed inside params so the gateway can extract and upload to R2.
  const title    = flag(args, "--title");
  const desc     = flag(args, "--description");
  const category = flag(args, "--category");
  if (title)    params.title       = title;
  if (desc)     params.description = desc;
  if (category) params.category    = category;
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/topics/create", { params }, "pending", cfg.chainAddresses.chainId); return; }
  log("Creating topic..."); result(await cfg.gatewayClient.createTopic({ params }));
}

export async function runJoinWaitlist(args: string[], isDryRun: boolean): Promise<void> {
  const topicId = requireFlag(args, "--topic-id", "topic ID");
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/topics/join-waitlist", { topicId, citizenId }, citizenId, cfg.chainAddresses.chainId); return; }
  log("Joining waitlist..."); result(await cfg.gatewayClient.joinTopicWaitlist({ topicId, citizenId }));
}

export async function runDepositWaitlist(args: string[], isDryRun: boolean): Promise<void> {
  const topicId = requireFlag(args, "--topic-id", "topic ID");
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const amount = requireFlag(args, "--amount", "amount");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/topics/deposit-waitlist", { topicId, citizenId, amount }, citizenId, cfg.chainAddresses.chainId); return; }
  log("Depositing to waitlist..."); result(await cfg.gatewayClient.depositWaitlist({ topicId, citizenId, amount }));
}

export async function runActivateTopic(args: string[], isDryRun: boolean): Promise<void> {
  const topicId = requireFlag(args, "--topic-id", "topic ID");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/topics/activate", { topicId }, "pending", cfg.chainAddresses.chainId); return; }
  log("Activating topic..."); result(await cfg.gatewayClient.activateTopic({ topicId }));
}

// ── Matches ───────────────────────────────────────────────────────────────────

export async function runSubmitTurn(args: string[], isDryRun: boolean): Promise<void> {
  const matchId = requireFlag(args, "--match-id", "match ID");
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const payloadContentStr = flag(args, "--payload-content");
  const payloadContent = payloadContentStr ? JSON.parse(payloadContentStr) as Record<string, unknown> : undefined;
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
  const sideStr = requireFlag(args, "--side", "side (0 or 1)");
  const side = Number(sideStr) as 0 | 1;
  const amount = requireFlag(args, "--amount", "amount");
  const turnIndexStr = flag(args, "--turn-index");
  const turnIndex = turnIndexStr ? Number(turnIndexStr) : 0;
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/positions/open", { matchId, citizenId, side, amount, turnIndex }, citizenId, cfg.chainAddresses.chainId); return; }
  log("Opening position..."); result(await cfg.gatewayClient.openPosition({ matchId, citizenId, side, amount, turnIndex }));
}

export async function runClaimPosition(args: string[], isDryRun: boolean): Promise<void> {
  const matchId = requireFlag(args, "--match-id", "match ID");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/positions/claim", { matchId }, "pending", cfg.chainAddresses.chainId); return; }
  log("Claiming position..."); result(await cfg.gatewayClient.claimPosition({ matchId }));
}

// ── Settlements ───────────────────────────────────────────────────────────────

export async function runSubmitSettlementVote(args: string[], isDryRun: boolean): Promise<void> {
  const matchId = requireFlag(args, "--match-id", "match ID");
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const winningSideStr = requireFlag(args, "--winning-side", "winning side (0 or 1)");
  const winningSide = Number(winningSideStr) as 0 | 1;
  const reasonHash = flag(args, "--reason-hash") as `0x${string}` | undefined;
  const reasonURI = flag(args, "--reason-uri");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/settlements/submit-vote", { matchId, citizenId, winningSide, reasonHash, reasonURI }, citizenId, cfg.chainAddresses.chainId); return; }
  log("Submitting settlement vote..."); result(await cfg.gatewayClient.submitSettlementVote({ matchId, citizenId, winningSide, reasonHash, reasonURI }));
}

export async function runFileChallenge(args: string[], isDryRun: boolean): Promise<void> {
  const matchId = requireFlag(args, "--match-id", "match ID");
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const bondAmount = requireFlag(args, "--bond-amount", "bond amount");
  const reasonHash = flag(args, "--reason-hash") as `0x${string}` | undefined;
  const reasonURI = flag(args, "--reason-uri");
  const cfg = loadConfig();
  if (isDryRun) { dryRunGateway("/api/v1/agent/challenges/file", { matchId, citizenId, bondAmount, reasonHash, reasonURI }, citizenId, cfg.chainAddresses.chainId); return; }
  log("Filing challenge..."); result(await cfg.gatewayClient.fileChallenge({ matchId, citizenId, bondAmount, reasonHash, reasonURI }));
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
  result(await cfg.gatewayClient.waitForRequest(requestId, timeoutMs ? { timeoutMs: Number(timeoutMs) } : undefined));
}
