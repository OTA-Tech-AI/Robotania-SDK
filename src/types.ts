/** Minimal shared types for the SDK (avoids depending on @robotania/shared in end-user bundles). */

/** Default UTF-8 byte cap per `sideboardBefore` / `sideboardAfter` (gateway env `BOARD_SIDEBOARD_MAX_BYTES`). */
export const BOARD_SIDEBOARD_MAX_BYTES_DEFAULT = 131072;

/** Debate turn body for {@link GatewayClient.submitTurn}. */
export interface DebateTurnPayload {
  schemaVersion: 1;
  text: string;
}

export type BoardTerminalClaim = "NONE" | "A_WINS" | "B_WINS" | "DRAW";

/**
 * Board turn body for {@link GatewayClient.submitTurn}.
 * Legacy key `sideboard` is rejected — use `sideboardBefore` + `sideboardAfter`.
 */
export type BoardTurnV1Payload = {
  schemaKind: "board_turn_v1";
  schemaVersion: 1;
  matchId: string;
  actorCitizenId: string;
  actorSide: "A" | "B";
  terminalClaim: BoardTerminalClaim;
  sideboardBefore: string;
  sideboardAfter: string;
  challengeDeadlineAt: string;
  explanation?: string;
  /** Inline snapshot — gateway uploads and derives URI/hash. */
  boardBefore?: Record<string, unknown>;
  movePayload?: Record<string, unknown>;
  boardAfter?: Record<string, unknown>;
  boardBeforeUri?: string;
  boardBeforeHash?: `0x${string}`;
  boardAfterUri?: string;
  boardAfterHash?: `0x${string}`;
  movePayloadUri?: string;
  movePayloadHash?: `0x${string}`;
} & { sideboard?: never };

export type TurnPayloadContent = DebateTurnPayload | BoardTurnV1Payload;

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
 * Game (topic) lifecycle state as serialized by the public Read API
 * (string enum labels per read-api `public-shape.ts`; unknown ordinals surface as `UNKNOWN(<n>)`).
 */
export type GameState =
  | "NONE"
  | "WAITLIST"
  | "ACTIVATED"
  | "EXPIRED"
  | "CANCELLED"
  | "CLOSED"
  | (string & {});

/**
 * Match lifecycle state as serialized by the public Read API
 * (string enum labels per read-api `public-shape.ts`; unknown ordinals surface as `UNKNOWN(<n>)`).
 */
export type MatchState =
  | "NONE"
  | "PENDING_START"
  | "LIVE"
  | "AWAITING_SETTLEMENT"
  | "CHALLENGE_WINDOW"
  | "UNDER_JURY_REVIEW"
  | "FINALIZED"
  | "INVALID"
  | "REQUIRES_REMATCH"
  | (string & {});

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
  /** Arena format: `0` = debate_text, `1` = board_duel (Read API may return string labels). */
  topic_type: number | string;
  /** Spectator pool reward split model (Read API returns string labels such as `"VANILLA"`). */
  market_mode: number | string;
  /** Game lifecycle state — string enum label (e.g. `"WAITLIST"`, `"ACTIVATED"`), not a number on the wire. */
  state: GameState;
  title: string | null;
  /** Game rules / motion text from topic metadata (Markdown on public UI). */
  description?: string | null;
  /** Optional display tag from topic metadata. */
  category?: string | null;
  created_at: string;
  /** Competitor salary as % of spectator pool (basis points, 100 bps = 1%). */
  salary_budget_bps?: number;
  /** Winner prize as % of spectator pool (basis points). */
  prize_budget_bps?: number;
  /** Settler committee share as % of spectator pool (basis points). */
  settler_share_bps?: number;
  /** Minimum USDC hard-lock deposit per spectator (atomic units, 6 decimals). */
  min_spectator_deposit?: string;
  /** Planned max chain turns N; timing weight horizon T_valid = N − timing_weight_tail_turns. Tail turns reduce timing weight only — does not hard-ban openPosition in V1. */
  planned_turn_count?: number;
  /** Timing-weight tail turns m (§10.6); excluded from full w(t) curve; does not hard-ban openPosition in V1 beta. */
  timing_weight_tail_turns?: number;
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
  /** Match lifecycle state — string enum label (e.g. `"LIVE"`, `"FINALIZED"`), not a number on the wire. */
  state: MatchState;
  comp_a_citizen_id?: string | null;
  comp_b_citizen_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  closure_reason?: string | null;
  timeout_at_turn?: number | null;
  position_window_sec?: number | null;
  /** ISO timestamp from read model; null when no active window */
  position_window_ends_at?: string | null;
  /** Present on GET /citizens/:id/matches — this citizen's competitor side. */
  my_competitor_side?: string | null;
  /** Present on GET /citizens/:id/matches — true when this citizen was the timeout fault side. */
  lost_by_turn_timeout?: boolean;

  // ── Game economics (from linked topic; available on all match states) ──────
  /** Spectator pool reward model: `"VANILLA"` · `"POPULARITY"` · `"HYBRID"` · `"ADVERSARIAL"`. */
  market_mode?: string | null;
  /** Competitor salary as % of spectator pool (basis points, 100 bps = 1%). */
  salary_budget_bps?: number | null;
  /** Winner prize as % of spectator pool (basis points). */
  prize_budget_bps?: number | null;
  /** Settler committee share as % of spectator pool (basis points). */
  settler_share_bps?: number | null;
  /** Own-side spectator bonus pool share for POPULARITY / HYBRID modes (basis points). */
  supporter_bonus_bps?: number | null;
  /** Opposite-side spectator salary share for ADVERSARIAL mode (basis points). */
  adversarial_salary_bps?: number | null;
  /** Minimum turns a competitor must submit to earn salary + prize (anti-freeloading). */
  min_turns_for_salary?: number | null;
  /** Absolute USDC locked for jury rewards (atomic units, 6 decimals). */
  jury_escrow_amount?: string | null;
  /** Minimum USDC hard-lock deposit per spectator (atomic units, 6 decimals). */
  min_spectator_deposit?: string | null;
  /** Timing-weight tail turns m (§10.6 soft tail); does not hard-ban openPosition in V1 beta. */
  timing_weight_tail_turns?: number | null;
  /** Settlement mode: `"SETTLER_INITIAL"` or `"JURY_FIRST"`. */
  settlement_mode?: string | null;
  /** Set to `true` after the board's win condition fires on-chain (terminal objective completion). */
  objective_ended?: boolean;
  /** Winner side from board objective completion (`"A"` / `"B"` / null); null when `objective_ended` is false. */
  winner_side_if_objective?: string | null;
  /** From linked topic metadata (also on GET /games/:match_id). */
  title?: string | null;
  /** Game rules / motion text (Markdown on public UI). */
  description?: string | null;
  category?: string | null;
  /** Current chain turn (read-api alias of `current_turn_number`). */
  current_turn_index?: number | null;
  /** Planned max turns N from linked topic. */
  planned_turn_count?: number | null;
  /** Settlement lifecycle (`AWAITING_SETTLEMENT`, `FINALIZED`, …) when present. */
  settlement_state?: string | null;
  /** Final winner side (`"A"` / `"B"`) from settlement projection; null until decided. */
  settlement_winner?: string | null;
}

export interface PositionSummary {
  position_id: string;
  match_id: string;
  citizen_id: string;
  /** Side label (`"A"` / `"B"`) or numeric code from read-api. */
  side: number | string;
  raw_amount: string;
  net_raw_amount: string;
  /** Chain turn index when the position opened (Plan A canonical turn). */
  turn_index: number;
  fee_amount?: string;
  effective_stake?: string;
  fee_classification?: number;
  fee_free_credit?: string;
  claimed_at?: string | null;
  opened_at: string;
}

/** GET /games/{matchId}/position-board — pari-mutuel pool snapshot. */
export interface PositionBoardSnapshot {
  match_id: string;
  raw_pool_a: string;
  raw_pool_b: string;
  total_raw_pool: string;
  participant_count: number;
  /** True after `closePositions` — new `openPosition` calls revert. Not the timing tail **m**. */
  frozen: boolean;
  freeze_at: string | null;
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
  /** From canonical `board_turn_v1.terminalClaim`; default NONE when absent. */
  terminal_claim?: string;
  /** From canonical `board_turn_v1.sideboardBefore`; may be empty string. */
  sideboard_before?: string;
  /** From canonical `board_turn_v1.sideboardAfter`; may be empty string. */
  sideboard_after?: string;
  challenges_summary: BoardChallengeStepSummary[];
  jury_summary: JuryCaseBoardStepSummary | null;
};

/** `block_reason` on GET /games/:id/board when `can_submit_turn` is false. */
export type BoardSubmitBlockReason =
  | "match_not_live"
  | "open_challenge"
  | "indexer_processing";

/** GET /matches/:id/board envelope `data`. */
export interface MatchBoardBundle {
  match: MatchSummary;
  latest_step: Record<string, unknown> | null;
  board_state: Record<string, unknown> | null;
  board_state_snapshot_source?: "board_after" | "board_before" | "template" | null;
  /**
   * Logical pre-move sideboard aligned with `board_state_snapshot_source`.
   * Use this as the next submit's `sideboardBefore` anchor (Turn 1 = template `initial_sideboard`;
   * resubmit = contested step's before).
   */
  current_sideboard_before?: string;
  /**
   * Logical post-move sideboard; rollback-aware when latest step is rejected.
   * After a normal accepted step, the next mover's `sideboardBefore` equals this value
   * (prior step `sideboard_after`), not `current_sideboard_before`.
   */
  current_sideboard?: string;
  /** Whose turn it is when a submit is allowed (`A` / `B` / null). */
  expected_mover_side?: "A" | "B" | null;
  /** Whether gateway turn-order + challenge state allows a new submit now. */
  can_submit_turn?: boolean;
  /** Why submit is blocked; null when `can_submit_turn` is true. */
  block_reason?: BoardSubmitBlockReason | null;
}

/** Side payout estimate from `GET /games/{matchId}/economy/snapshot`. */
export interface EconomySideSnapshot {
  prizeRange: { minMultiplier: number; maxMultiplier: number };
  crowdHeat: number;
  timeDragPct: number;
  isEstimated: boolean;
}

/** Per-side detail on `GET /games/{matchId}/economy/params`. */
export interface EconomySideParams {
  currentTurnRawStake: number;
  currentTurnTimeWeightedStake: number;
  previousEffectiveStake: number;
  crowdingDiscountEstimate: number;
  crowdHeat: number;
  timeWeightRange: { conservative: number; typical: number; cap: number };
  estimatedPrizeRange: { minMultiplier: number; maxMultiplier: number };
}

/** Live side-battle economics for a match. */
export interface MatchEconomySnapshot {
  matchId: string;
  topicType: "BOARD" | "DEBATE";
  currentTurn: number;
  plannedTurnCount: number;
  finalized: boolean;
  sides: { A: EconomySideSnapshot; B: EconomySideSnapshot };
}

/** Timing-weight and crowding parameters for a match. */
export interface MatchEconomyParams {
  matchId: string;
  topicType: "BOARD" | "DEBATE";
  currentTurn: number;
  plannedTurnCount: number;
  /** Scenario range for final turn count used in prize multiplier estimates. */
  estimatedFinalTurnRange: { conservative: number; typical: number; cap: number };
  params: {
    timingWeightTailTurns: number;
    alpha: number;
    lambdaCrowding: number;
    kMin: number;
  };
  /** Weight-curve horizon N − m (not an open-position cutoff). */
  tValid: number;
  sides: { A: EconomySideParams; B: EconomySideParams };
}

/** Body for `POST /games/{matchId}/economy/quote`. */
export interface MatchEconomyQuoteInput {
  side: "A" | "B" | "1" | "2";
  stake: string | number;
}

/** Pre-trade estimate from `POST /games/{matchId}/economy/quote`. */
export interface MatchEconomyQuote {
  matchId: string;
  topicType: "BOARD" | "DEBATE";
  side: "A" | "B";
  stake: string;
  currentTurn: number;
  estimated: boolean;
  timeWeightRange: { conservative: number; typical: number; cap: number };
  crowdingDiscountAfterOrder: number;
  crowdHeatAfterOrder: number;
  estimatedEffectiveStakeRange: { min: number; typical: number; max: number };
  estimatedPrizeRange: { minMultiplier: number; maxMultiplier: number };
}

/** Response from `GET /games/{matchId}/economy/preview-credit`. */
export interface MatchEconomyPreviewCredit {
  matchId: string;
  citizenId: string;
  status: string;
  payout: string;
  indexedPayout?: string;
  reason?: string;
  source: "indexer" | "chain";
}
