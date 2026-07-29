import type { AgentWsEvent } from "../agent-ws-events.js";

export class Dedupe {
  private readonly seen = new Map<string, number>();

  constructor(private readonly windowMs = 10_000) {}

  has(event: AgentWsEvent): boolean {
    const key = this.buildKey(event);
    const now = Date.now();
    const last = this.seen.get(key);
    return last !== undefined && now - last < this.windowMs;
  }

  mark(event: AgentWsEvent): void {
    const now = Date.now();
    const key = this.buildKey(event);
    this.seen.set(key, now);
    this.prune(now);
  }

  isDuplicate(event: AgentWsEvent): boolean {
    if (this.has(event)) return true;
    this.mark(event);
    return false;
  }

  private buildKey(event: AgentWsEvent): string {
    if (event.eventId) return `event:${event.eventId}`;
    switch (event.type) {
      case "MATCH_LIVE":
        return `match_live:${event.matchId}`;
      case "MATCH_AWAITING_SETTLEMENT":
      case "MATCH_UNDER_JURY_REVIEW":
      case "MATCH_FINALIZED":
        return `${event.type}:${event.matchId}`;
      case "TURN_SUBMITTED":
        return `turn:${event.matchId}:${event.turnNumber}`;
      case "JURY_ASSIGNED":
        return `jury:${event.juryCaseId}`;
      case "JURY_CASE_UPDATE":
        return `jury_case_update:${event.juryCaseId}:${event.state ?? ""}`;
      case "GAME_ACTIVATED":
        return `topic:${event.topicId}:${event.matchId}`;
      case "BOARD_STEP_UPDATE":
        return `${event.type}:${event.matchId}:${event.stepId}:${event.status}`;
      case "BOARD_CHALLENGE_FILED":
        return `${event.type}:${event.matchId}:${event.challengeId ?? ""}`;
      case "BOARD_CHALLENGE_RULED":
        return `${event.type}:${event.matchId}:${event.challengeId ?? ""}`;
      case "BOARD_COMPLETE_MATCH_REQUIRED":
        return `${event.type}:${event.matchId}:${event.stepId}`;
      case "PAYOUT_CREDITED":
        return `payout:${event.citizenId}:${event.createdAt ?? ""}`;
      case "PRACTICE_MATCH_LIVE":
      case "PRACTICE_OFFICIAL_COMPETITOR_FILLED":
      case "PRACTICE_OFFICIAL_REVIEW":
      case "PRACTICE_FINISHED":
        return `${event.type}:${event.practiceMatchId}:${event.state}`;
      case "PRACTICE_TURN_SUBMITTED":
        return `practice_turn:${event.practiceMatchId}:${event.turnNumber}`;
      case "PRACTICE_BOARD_STEP_SUBMITTED":
      case "PRACTICE_BOARD_STEP_ACCEPTED":
        return `${event.type}:${event.practiceMatchId}:${event.stepId}`;
      case "PRACTICE_BOARD_CHALLENGE_FILED":
      case "PRACTICE_BOARD_CHALLENGE_RULED":
        return `${event.type}:${event.practiceMatchId}:${event.challengeId}`;
      case "PRACTICE_JURY_ASSIGNED":
        return `practice_jury:${event.practiceJuryCaseId}`;
      default:
        return `${event.type}:${event.revision ?? ""}`;
    }
  }

  private prune(now: number): void {
    for (const [key, ts] of this.seen) {
      if (now - ts > this.windowMs * 10) this.seen.delete(key);
    }
  }
}
