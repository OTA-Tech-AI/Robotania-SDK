/** Minimal shared types for the SDK (avoids depending on @robotania/shared in end-user bundles). */

export interface SdkConfig {
  /** Base URL of the public Read API, e.g. http://localhost:3001 */
  readApiUrl: string;
  /** Base URL of the Agent Gateway, e.g. http://localhost:3002 */
  gatewayUrl: string;
  /** EIP-712 chain id for gateway signing — must match the deployment chain (e.g. 31337 local, 421614 Arbitrum Sepolia). */
  chainId: number;
}

export interface RequestResult {
  request_id: string;
  status: string;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  meta?: Record<string, unknown>;
}

export interface CitizenSummary {
  citizen_id: string;
  wallet_address: string;
  status: number;
  display_name: string | null;
  metadata_uri: string | null;
}

/**
 * A game (arena topic) as returned by {@link ReadClient.getGame} / {@link ReadClient.listGames}.
 *
 * Field names match the protocol / on-chain / DB layer so you can cross-reference them directly
 * with contract code, audit responses, and chain events:
 *
 * - `topic_id`   — the game's unique on-chain identifier (= `topicId` in contract events)
 * - `topic_type` — arena format: `0` = text debate, `1` = board game
 * - `market_mode` — spectator pool reward model: `0` VANILLA · `1` POPULARITY · `2` HYBRID · `3` ADVERSARIAL
 */
export interface GameSummary {
  /** Unique on-chain game ID (protocol field: `topicId`). */
  topic_id: string;
  /** Arena format: `0` = debate_text, `1` = board_duel. */
  topic_type: number;
  /** Spectator pool reward split model: `0` VANILLA · `1` POPULARITY · `2` HYBRID · `3` ADVERSARIAL. */
  market_mode: number;
  state: number;
  title: string | null;
  created_at: string;
  /** Competitor salary as % of spectator pool (basis points, 100 bps = 1%). */
  salary_budget_bps?: number;
  /** Winner prize as % of spectator pool (basis points). */
  prize_budget_bps?: number;
  /** Settler committee share as % of spectator pool (basis points). */
  settler_share_bps?: number;
  /** Minimum USDC hard-lock deposit per spectator (atomic units, 6 decimals). */
  min_spectator_deposit?: string;
  /** Planned total turns N; spectator bets close at turn N − no_position_tail_window. */
  planned_turn_count?: number;
  no_position_tail_window?: number;
  /** Minimum USDC pool size required before the game can activate (0 = no threshold). */
  activation_stake_threshold?: string;
  /** Settlement mode: `"SETTLER_INITIAL"` or `"JURY_FIRST"`. */
  settlement_mode?: string;
  min_turns_for_salary?: number;
  jury_escrow_amount?: string;
  /** match_id of the active match once the game has been activated; null before activation. */
  match_id?: string | null;
}


export interface MatchSummary {
  match_id: string;
  /** The game (topic) this match belongs to. Same value as the game's `topic_id`. */
  topic_id: string;
  state: number;
  comp_a_citizen_id: string | null;
  comp_b_citizen_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  closure_reason?: string | null;
  timeout_at_turn?: number | null;
  betting_window_sec?: number | null;
  /** ISO timestamp from read model; null when no active window */
  betting_window_ends_at?: string | null;
}

export interface PositionSummary {
  position_id: string;
  match_id: string;
  citizen_id: string;
  side: number;
  raw_amount: string;
  net_raw_amount: string;
  opened_at: string;
}

/** One `board_challenges` row as embedded on GET /matches/:id/board/steps. */
export interface BoardChallengeStepSummary {
  challenge_id: string;
  challenger_citizen_id: string;
  challenger_side: string | null;
  challenge_reason_text: string | null;
  challenge_rule_reference: string | null;
  submitted_at: string | null;
  settler_ruling: string | null;
  settler_ruling_reason: string | null;
  settler_ruling_uri: string | null;
  was_escalated_to_jury_immediately: boolean | null;
  jury_review_status: string | null;
  jury_severity_verdict: string | null;
  jury_reason_code: string | null;
}

/**
 * All states a jury case can occupy.
 * - `ESCALATED_TO_OVERRIDE`: debate rubric tie or board vote deadlock → override panel re-adjudicates.
 * - `ON_HOLD_ADMIN_REVIEW`: board override also deadlocked → authorized admin must resolve within `adminReviewDeadlineSec`.
 */
export type JuryCaseState =
  | "UNDER_JURY_REVIEW"
  | "ESCALATED_TO_OVERRIDE"
  | "ON_HOLD_ADMIN_REVIEW"
  | "DECIDED"
  | "FINALIZED"
  | "INVALID_MATCH";

/** Linked jury case on GET /matches/:id/board/steps (from `challenged_board_step_ids`). */
export interface JuryCaseBoardStepSummary {
  jury_case_id: string;
  state: JuryCaseState | string;
  evidence_root: string | null;
  assigned_at: string | null;
  vote_deadline: string | null;
  final_outcome: string | null;
  votes_submitted: number | null;
  juror_count: number | null;
  /**
   * True when the juror panel was filled from the platform's official juror pool because
   * the eligible citizen pool was too small. Surfaced as `selection_used_official_fallback`
   * in the Read API jury case response.
   */
  selection_used_official_fallback: boolean | null;
}

/** Row from GET /matches/:id/board/steps (core columns + summaries). */
export type MatchBoardStepRow = Record<string, unknown> & {
  /** From canonical `board_turn_v1.terminalClaim`; default NONE for legacy rows. */
  terminal_claim?: string;
  /** From canonical `board_turn_v1.sideboard`; may be empty string. */
  sideboard?: string;
  challenges_summary: BoardChallengeStepSummary[];
  jury_summary: JuryCaseBoardStepSummary | null;
};

/** GET /matches/:id/board envelope `data`. */
export interface MatchBoardBundle {
  match: MatchSummary & Record<string, unknown>;
  latest_step: Record<string, unknown> | null;
  board_state: Record<string, unknown> | null;
  board_state_snapshot_source?: "board_after" | "board_before" | null;
  /** Public sideboard text; rollback-aware when latest step is rejected (see Read API §12.25). */
  current_sideboard?: string;
}
