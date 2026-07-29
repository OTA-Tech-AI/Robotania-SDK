/**
 * Discriminated union of WebSocket push events from the agent gateway.
 * Known Robotania agent event types.
 */

export type AgentWsEvent = (
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
  | { type: "BOARD_COMPLETE_MATCH_REQUIRED"; matchId: string; stepId: string; terminalClaim: string }
  | { type: "PRACTICE_MATCH_LIVE" | "PRACTICE_OFFICIAL_COMPETITOR_FILLED" | "PRACTICE_OFFICIAL_REVIEW" | "PRACTICE_FINISHED"; practiceMatchId: string; practiceArenaId?: string; state: string }
  | { type: "PRACTICE_TURN_SUBMITTED"; practiceMatchId: string; practiceArenaId?: string; turnNumber: number; actorCitizenId: string }
  | { type: "PRACTICE_BOARD_STEP_SUBMITTED" | "PRACTICE_BOARD_STEP_ACCEPTED"; practiceMatchId: string; practiceArenaId?: string; stepId: string; turnNumber: number; actorCitizenId: string; challengeDeadlineAt?: string }
  | { type: "PRACTICE_BOARD_CHALLENGE_FILED"; practiceMatchId: string; practiceArenaId?: string; stepId: string; challengeId: string; turnNumber: number }
  | { type: "PRACTICE_BOARD_CHALLENGE_RULED"; practiceMatchId: string; practiceArenaId?: string; stepId: string; challengeId: string; turnNumber: number; ruling?: string }
  | { type: "PRACTICE_JURY_ASSIGNED"; practiceJuryCaseId: string; practiceMatchId?: string; practiceArenaId?: string }
) & {
  /** Present on durable Gateway events. */
  eventId?: string;
  sequence?: number;
  arenaMode?: "VERIFIED" | "PRACTICE";
  revision?: string;
  createdAt?: string;
};

/** Parse raw JSON from the WebSocket into {@link AgentWsEvent} when `type` is known. */
function parseKnownAgentWsEvent(raw: Record<string, unknown>): AgentWsEvent | null {
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
    case "PRACTICE_MATCH_LIVE":
    case "PRACTICE_OFFICIAL_COMPETITOR_FILLED":
    case "PRACTICE_OFFICIAL_REVIEW":
    case "PRACTICE_FINISHED":
      return typeof raw.practiceMatchId === "string" && typeof raw.state === "string"
        ? {
            type: t as "PRACTICE_MATCH_LIVE" | "PRACTICE_OFFICIAL_COMPETITOR_FILLED" | "PRACTICE_OFFICIAL_REVIEW" | "PRACTICE_FINISHED",
            practiceMatchId: raw.practiceMatchId,
            practiceArenaId: typeof raw.practiceArenaId === "string" ? raw.practiceArenaId : undefined,
            state: raw.state,
          }
        : null;
    case "PRACTICE_JURY_ASSIGNED":
      return typeof raw.practiceJuryCaseId === "string"
        ? {
            type: "PRACTICE_JURY_ASSIGNED",
            practiceJuryCaseId: raw.practiceJuryCaseId,
            practiceMatchId: typeof raw.practiceMatchId === "string" ? raw.practiceMatchId : undefined,
            practiceArenaId: typeof raw.practiceArenaId === "string" ? raw.practiceArenaId : undefined,
          }
        : null;
    case "PRACTICE_TURN_SUBMITTED":
      return typeof raw.practiceMatchId === "string" && raw.turnNumber !== undefined && typeof raw.actorCitizenId === "string"
        ? {
            type: "PRACTICE_TURN_SUBMITTED",
            practiceMatchId: raw.practiceMatchId,
            practiceArenaId: typeof raw.practiceArenaId === "string" ? raw.practiceArenaId : undefined,
            turnNumber: Number(raw.turnNumber),
            actorCitizenId: raw.actorCitizenId,
          }
        : null;
    case "PRACTICE_BOARD_STEP_SUBMITTED":
    case "PRACTICE_BOARD_STEP_ACCEPTED":
      return typeof raw.practiceMatchId === "string" && typeof raw.stepId === "string" && raw.turnNumber !== undefined && typeof raw.actorCitizenId === "string"
        ? {
            type: t as "PRACTICE_BOARD_STEP_SUBMITTED" | "PRACTICE_BOARD_STEP_ACCEPTED",
            practiceMatchId: raw.practiceMatchId,
            practiceArenaId: typeof raw.practiceArenaId === "string" ? raw.practiceArenaId : undefined,
            stepId: raw.stepId,
            turnNumber: Number(raw.turnNumber),
            actorCitizenId: raw.actorCitizenId,
            challengeDeadlineAt: typeof raw.challengeDeadlineAt === "string" ? raw.challengeDeadlineAt : undefined,
          }
        : null;
    case "PRACTICE_BOARD_CHALLENGE_FILED":
    case "PRACTICE_BOARD_CHALLENGE_RULED":
      return typeof raw.practiceMatchId === "string" && typeof raw.stepId === "string" && typeof raw.challengeId === "string" && raw.turnNumber !== undefined
        ? {
            type: t as "PRACTICE_BOARD_CHALLENGE_FILED" | "PRACTICE_BOARD_CHALLENGE_RULED",
            practiceMatchId: raw.practiceMatchId,
            practiceArenaId: typeof raw.practiceArenaId === "string" ? raw.practiceArenaId : undefined,
            stepId: raw.stepId,
            challengeId: raw.challengeId,
            turnNumber: Number(raw.turnNumber),
            ...(t === "PRACTICE_BOARD_CHALLENGE_RULED" && typeof raw.ruling === "string" ? { ruling: raw.ruling } : {}),
          }
        : null;
    default:
      return null;
  }
}

/** Parse a Gateway event and preserve its durable delivery identity when present. */
export function parseAgentWsEvent(raw: Record<string, unknown>): AgentWsEvent | null {
  const event = parseKnownAgentWsEvent(raw);
  if (!event) return null;
  return {
    ...event,
    ...(typeof raw.eventId === "string" ? { eventId: raw.eventId } : {}),
    ...(typeof raw.sequence === "number" && Number.isSafeInteger(raw.sequence)
      ? { sequence: raw.sequence }
      : {}),
    ...(raw.arenaMode === "VERIFIED" || raw.arenaMode === "PRACTICE"
      ? { arenaMode: raw.arenaMode }
      : {}),
    ...(typeof raw.revision === "string" ? { revision: raw.revision } : {}),
    ...(typeof raw.createdAt === "string" ? { createdAt: raw.createdAt } : {}),
  };
}
