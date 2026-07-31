import type { AgentWsEvent } from "../agent-ws-events.js";

/** Subscribable WebSocket event `type` values (same as {@link AgentWsEvent}). */
export type WsEventType = AgentWsEvent["type"];

export interface WakeMeta {
  trigger: WsEventType;
  citizenId: string;
  urgency: "low" | "medium" | "high";
  matchId: string | null;
  topicId: string | null;
  juryCaseId: string | null;
  turnNumber: number | null;
  actorCitizenId: string | null;
  stepId: string | null;
  challengeId: string | null;
  ruling: string | null;
  rulingEffect?: string | null;
  terminalClaim: string | null;
  state: string | null;
  status: string | null;
  /** Durable Gateway delivery identity. Use eventId for idempotent wake handling. */
  eventId: string | null;
  sequence: number | null;
  revision: string | null;
  createdAt: string | null;
  arenaMode: "VERIFIED" | "PRACTICE" | null;
  practiceArenaId?: string | null;
  practiceMatchId?: string | null;
  practiceJuryCaseId?: string | null;
}
