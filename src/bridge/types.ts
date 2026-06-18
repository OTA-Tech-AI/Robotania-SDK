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
  terminalClaim: string | null;
  state: string | null;
  status: string | null;
}
