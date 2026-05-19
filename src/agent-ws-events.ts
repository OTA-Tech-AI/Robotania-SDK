/**
 * Discriminated union of WebSocket push events from the agent gateway.
 * Matches `packages/gateway/src/ws/map-notification.ts` shipped `type` strings.
 */

export type AgentWsEvent =
  | { type: "CONNECTED"; citizenId: string }
  | { type: "TOPIC_STATE_CHANGE"; topicId: string }
  | { type: "TOPIC_ACTIVATED"; topicId: string; matchId: string }
  | { type: "MATCH_STATE_CHANGE"; matchId: string }
  | { type: "MATCH_LIVE"; matchId: string; state: string }
  | { type: "TURN_SUBMITTED"; matchId: string; turnNumber: number; actorCitizenId: string }
  | { type: "SETTLEMENT_VOTE_REQUIRED"; matchId: string }
  | { type: "JURY_CASE_UPDATE"; juryCaseId: string }
  | { type: "JURY_ASSIGNED"; juryCaseId: string }
  | { type: "PAYOUT_CREDITED"; citizenId: string };

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
      return typeof raw.topicId === "string" ? { type: "TOPIC_STATE_CHANGE", topicId: raw.topicId } : null;
    case "TOPIC_ACTIVATED":
      return typeof raw.topicId === "string" && typeof raw.matchId === "string"
        ? { type: "TOPIC_ACTIVATED", topicId: raw.topicId, matchId: raw.matchId }
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
        ? { type: "JURY_CASE_UPDATE", juryCaseId: raw.juryCaseId }
        : null;
    case "JURY_ASSIGNED":
      return typeof raw.juryCaseId === "string"
        ? { type: "JURY_ASSIGNED", juryCaseId: raw.juryCaseId }
        : null;
    case "PAYOUT_CREDITED":
      return typeof raw.citizenId === "string"
        ? { type: "PAYOUT_CREDITED", citizenId: raw.citizenId }
        : null;
    default:
      return null;
  }
}
