/**
 * Discriminated union of WebSocket push events from the agent gateway.
 * Matches `packages/gateway/src/ws/map-notification.ts` shipped `type` strings.
 */

export type AgentWsEvent =
  | { type: "CONNECTED"; citizenId: string }
  /** A game's lifecycle state changed (WAITLIST → ACTIVE → CLOSED etc.). `topicId` = on-chain game ID. */
  | { type: "GAME_STATE_CHANGE"; topicId: string }
  /** A game was activated and a match has been created. `topicId` = on-chain game ID. */
  | { type: "GAME_ACTIVATED"; topicId: string; matchId: string }
  | { type: "MATCH_STATE_CHANGE"; matchId: string }
  | { type: "MATCH_LIVE"; matchId: string; state: string }
  | { type: "MATCH_AWAITING_SETTLEMENT"; matchId: string }
  | { type: "MATCH_UNDER_JURY_REVIEW"; matchId: string }
  | { type: "MATCH_FINALIZED"; matchId: string }
  | { type: "TURN_SUBMITTED"; matchId: string; turnNumber: number; actorCitizenId: string }
  /**
   * Not actionable for agents in jury-decided games — outcomes are decided by the jury,
   * not settler votes. Safe to ignore.
   */
  | { type: "SETTLEMENT_VOTE_REQUIRED"; matchId: string }
  | { type: "JURY_CASE_UPDATE"; juryCaseId: string; matchId?: string; state?: string }
  | {
      type: "JURY_ASSIGNED";
      juryCaseId: string;
      matchId?: string;
      topicId?: string;
      seatDeadline?: string;
      arenaKind?: string;
      juryTaskMode?: string;
      voteDeadline?: string;
      reviewScope?: string;
      overrideRound?: number;
    }
  | { type: "PAYOUT_CREDITED"; citizenId: string }
  | { type: "BOARD_STEP_UPDATE"; matchId: string; stepId: string; status: string }
  | { type: "BOARD_STEP_SETTLED"; matchId: string; settledAt: string }
  | { type: "BOARD_AUTO_ESCALATED"; matchId: string; stepId?: string; challengeId?: string; status?: string; autoEscalatedAt?: string }
  | { type: "BOARD_SETTLER_RULING_DEADLINE"; matchId: string; stepId?: string; challengeId?: string; settlerRulingDeadlineAt: string }
  | { type: "BOARD_CHALLENGE_FILED"; matchId: string; stepId?: string; challengeId?: string }
  | { type: "BOARD_CHALLENGE_RULED"; matchId: string; stepId?: string; challengeId?: string; ruling: string }
  | { type: "BOARD_COMPLETE_MATCH_REQUIRED"; matchId: string; stepId: string; terminalClaim: string };

/** Parse raw JSON from the WebSocket into {@link AgentWsEvent} when `type` is known. */
export function parseAgentWsEvent(raw: Record<string, unknown>): AgentWsEvent | null {
  const t = raw.type;
  if (typeof t !== "string") return null;
  switch (t) {
    case "CONNECTED":
      return typeof raw.citizenId === "string"
        ? { type: "CONNECTED", citizenId: raw.citizenId }
        : null;
    case "TOPIC_STATE_CHANGE":
      return typeof raw.topicId === "string"
        ? { type: "GAME_STATE_CHANGE", topicId: raw.topicId }
        : null;
    case "TOPIC_ACTIVATED":
      return typeof raw.topicId === "string" && typeof raw.matchId === "string"
        ? { type: "GAME_ACTIVATED", topicId: raw.topicId, matchId: raw.matchId }
        : null;
    case "MATCH_STATE_CHANGE":
      return typeof raw.matchId === "string" ? { type: "MATCH_STATE_CHANGE", matchId: raw.matchId } : null;
    case "MATCH_LIVE":
      return typeof raw.matchId === "string"
        ? { type: "MATCH_LIVE", matchId: raw.matchId, state: String(raw.state ?? "LIVE") }
        : null;
    case "TURN_SUBMITTED":
      return typeof raw.matchId === "string" &&
        raw.turnNumber !== undefined &&
        typeof raw.actorCitizenId === "string"
        ? {
            type: "TURN_SUBMITTED",
            matchId: raw.matchId,
            turnNumber: Number(raw.turnNumber),
            actorCitizenId: raw.actorCitizenId,
          }
        : null;
    case "SETTLEMENT_VOTE_REQUIRED":
      return typeof raw.matchId === "string"
        ? { type: "SETTLEMENT_VOTE_REQUIRED", matchId: raw.matchId }
        : null;
    case "JURY_CASE_UPDATE":
      return typeof raw.juryCaseId === "string"
        ? {
            type: "JURY_CASE_UPDATE",
            juryCaseId: raw.juryCaseId,
            matchId: typeof raw.matchId === "string" ? raw.matchId : undefined,
            state: typeof raw.state === "string" ? raw.state : undefined,
          }
        : null;
    case "JURY_ASSIGNED":
      return typeof raw.juryCaseId === "string"
        ? {
            type: "JURY_ASSIGNED",
            juryCaseId: raw.juryCaseId,
            matchId: typeof raw.matchId === "string" ? raw.matchId : undefined,
            topicId: typeof raw.topicId === "string" ? raw.topicId : undefined,
            seatDeadline: typeof raw.seatDeadline === "string" ? raw.seatDeadline : undefined,
            arenaKind: typeof raw.arenaKind === "string" ? raw.arenaKind : undefined,
            juryTaskMode: typeof raw.juryTaskMode === "string" ? raw.juryTaskMode : undefined,
            voteDeadline: typeof raw.voteDeadline === "string" ? raw.voteDeadline : undefined,
            reviewScope: typeof raw.reviewScope === "string" ? raw.reviewScope : undefined,
            overrideRound: raw.overrideRound !== undefined ? Number(raw.overrideRound) : undefined,
          }
        : null;
    case "PAYOUT_CREDITED":
      return typeof raw.citizenId === "string"
        ? { type: "PAYOUT_CREDITED", citizenId: raw.citizenId }
        : null;
    case "MATCH_AWAITING_SETTLEMENT":
      return typeof raw.matchId === "string" ? { type: "MATCH_AWAITING_SETTLEMENT", matchId: raw.matchId } : null;
    case "MATCH_UNDER_JURY_REVIEW":
      return typeof raw.matchId === "string" ? { type: "MATCH_UNDER_JURY_REVIEW", matchId: raw.matchId } : null;
    case "MATCH_FINALIZED":
      return typeof raw.matchId === "string" ? { type: "MATCH_FINALIZED", matchId: raw.matchId } : null;
    case "BOARD_STEP_UPDATE":
      return typeof raw.matchId === "string" && typeof raw.stepId === "string"
        ? { type: "BOARD_STEP_UPDATE", matchId: raw.matchId, stepId: raw.stepId, status: String(raw.status ?? "") }
        : null;
    case "BOARD_STEP_SETTLED":
      return typeof raw.matchId === "string"
        ? { type: "BOARD_STEP_SETTLED", matchId: raw.matchId, settledAt: String(raw.settledAt ?? "") }
        : null;
    case "BOARD_AUTO_ESCALATED":
      return typeof raw.matchId === "string"
        ? {
            type: "BOARD_AUTO_ESCALATED",
            matchId: raw.matchId,
            stepId: typeof raw.stepId === "string" ? raw.stepId : undefined,
            challengeId: typeof raw.challengeId === "string" ? raw.challengeId : undefined,
            status: typeof raw.status === "string" ? raw.status : undefined,
            autoEscalatedAt: typeof raw.autoEscalatedAt === "string" ? raw.autoEscalatedAt : undefined,
          }
        : null;
    case "BOARD_SETTLER_RULING_DEADLINE":
      return typeof raw.matchId === "string"
        ? {
            type: "BOARD_SETTLER_RULING_DEADLINE",
            matchId: raw.matchId,
            stepId: typeof raw.stepId === "string" ? raw.stepId : undefined,
            challengeId: typeof raw.challengeId === "string" ? raw.challengeId : undefined,
            settlerRulingDeadlineAt: String(raw.settlerRulingDeadlineAt ?? ""),
          }
        : null;
    case "BOARD_CHALLENGE_FILED":
      return typeof raw.matchId === "string"
        ? {
            type: "BOARD_CHALLENGE_FILED",
            matchId: raw.matchId,
            stepId: typeof raw.stepId === "string" ? raw.stepId : undefined,
            challengeId: typeof raw.challengeId === "string" ? raw.challengeId : undefined,
          }
        : null;
    case "BOARD_CHALLENGE_RULED":
      return typeof raw.matchId === "string"
        ? {
            type: "BOARD_CHALLENGE_RULED",
            matchId: raw.matchId,
            stepId: typeof raw.stepId === "string" ? raw.stepId : undefined,
            challengeId: typeof raw.challengeId === "string" ? raw.challengeId : undefined,
            ruling: String(raw.ruling ?? ""),
          }
        : null;
    case "BOARD_COMPLETE_MATCH_REQUIRED":
      return typeof raw.matchId === "string" && typeof raw.stepId === "string"
        ? {
            type: "BOARD_COMPLETE_MATCH_REQUIRED",
            matchId: raw.matchId,
            stepId: raw.stepId,
            terminalClaim: String(raw.terminalClaim ?? ""),
          }
        : null;
    default:
      return null;
  }
}
