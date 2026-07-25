import type { WsEventType } from "./types.js";

export const DEFAULT_SUBSCRIPTIONS: WsEventType[] = [
  "MATCH_LIVE",
  "MATCH_AWAITING_SETTLEMENT",
  "MATCH_UNDER_JURY_REVIEW",
  "MATCH_FINALIZED",
  "TURN_SUBMITTED",
  "JURY_ASSIGNED",
  "JURY_CASE_UPDATE",
  "GAME_ACTIVATED",
  "BOARD_STEP_UPDATE",
  "BOARD_STEP_SETTLED",
  "BOARD_AUTO_ESCALATED",
  "BOARD_SETTLER_RULING_DEADLINE",
  "BOARD_CHALLENGE_FILED",
  "BOARD_CHALLENGE_RULED",
  "BOARD_COMPLETE_MATCH_REQUIRED",
  "PAYOUT_CREDITED",
  "PRACTICE_MATCH_LIVE",
  "PRACTICE_OFFICIAL_COMPETITOR_FILLED",
  "PRACTICE_OFFICIAL_REVIEW",
  "PRACTICE_FINISHED",
  "PRACTICE_TURN_SUBMITTED",
  "PRACTICE_JURY_ASSIGNED",
];

export class EventFilter {
  private readonly subscriptions: ReadonlySet<string>;

  constructor(subscriptions: WsEventType[] = DEFAULT_SUBSCRIPTIONS) {
    this.subscriptions = new Set(subscriptions);
  }

  shouldProcess(event: { type: string }): boolean {
    return this.subscriptions.has(event.type);
  }
}
