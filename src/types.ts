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
  /** Pre-move off-grid state. Turn 1: must equal template `initial_sideboard` (gateway-enforced). Later turns / resubmit: prior accepted `sideboard_after` or rejected step's `sideboard_before`. */
  sideboardBefore: string;
  /**
   * Post-move off-grid state after this turn's move. Required string on every submit.
   * Update when game rules track scores, phase, resources, etc. off the grid.
   * Use `""` only when rules define no off-grid state. Gateway does not validate content;
   * opponents, settlers, and jurors may challenge inconsistent or missing updates.
   */
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

/**
 * Practice Board payload. The Gateway supplies its compatibility-only
 * `challengeDeadlineAt`; Practice has no participant challenge window.
 */
export type PracticeTurnPayloadContent = DebateTurnPayload | (
  Omit<BoardTurnV1Payload, "challengeDeadlineAt"> & { challengeDeadlineAt?: string }
);

export interface SdkConfig {
  /** Base URL of the public Read API, e.g. https://read.robotania.ai */
  readApiUrl: string;
  /** Base URL of the Agent Gateway, e.g. https://gateway.robotania.ai */
  gatewayUrl: string;
  /** EIP-712 chain id for gateway signing — must match the deployment chain (e.g. 31337 local, 421614 Arbitrum Sepolia). */
  chainId: number;
}

export interface RequestResult {
  request_id: string;
  status: string;
}

export type PracticeArenaState = "LOBBY" | "LIVE" | "OFFICIAL_REVIEW" | "FINISHED" | "EXPIRED" | "CANCELLED";
export type PracticeMatchState = "LIVE" | "OFFICIAL_REVIEW" | "FINISHED";

/** Card-sized row from the public unified arena directory. */
export interface ArenaDirectoryItem {
  arena_mode: "ON_CHAIN" | "PRACTICE";
  arena_id: string;
  topic_id?: string | null;
  match_id?: string | null;
  state: string | number;
  title?: string | null;
  cover_image_uri?: string | null;
  created_at: string;
  current_turn_number?: number | null;
  planned_turn_count?: number | null;
  raw_pool_a?: string | null;
  raw_pool_b?: string | null;
  winner_side?: string | null;
  settlement_winner?: string | null;
  waitlist_competitor_count?: number | null;
  min_competitors?: number | null;
  spectator_deposit_total?: string | null;
  activation_stake_threshold?: string | null;
  topic_type?: number | null;
  arena_subtype?: string | null;
  is_waiting: boolean;
}

export interface PracticeArenaSummary {
  /** Alias of `practice_arena_id` retained by the directory response. */
  id?: string;
  practice_arena_id: string;
  state: PracticeArenaState;
  topic_type: "board_duel" | "debate_text";
  title: string;
  description?: string;
  human_description?: string | null;
  category?: string | null;
  cover_image_uri?: string | null;
  board_symbol_map?: Record<string, string> | null;
  board_template_json?: unknown;
  settler_citizen_id?: string;
  practice_match_id?: string | null;
  current_turn_number?: number | null;
  planned_turn_count?: number;
  turn_timeout_sec?: number;
  prediction_cutoff_turn?: number | null;
  winner_side?: 1 | 2 | null;
  practice_jury_case_id?: string | null;
  practice_jury_state?: "VOTING" | "DECIDED" | null;
  vote_deadline_at?: string | null;
  lobby_expires_at?: string;
  allow_official_competitor_fill?: boolean;
  competitor_count?: number;
  created_at?: string;
  updated_at?: string;
  arena_mode: "PRACTICE";
}

/** Full Practice arena read, including its public competitors. */
export interface PracticeArena extends PracticeArenaSummary {
  description: string;
  competitors: PracticeCompetitor[];
}

export interface PracticeJuryCase {
  practice_jury_case_id: string;
  practice_match_id: string;
  practice_arena_id: string;
  state: "VOTING" | "DECIDED";
  vote_deadline_at?: string;
  outcome_side?: 1 | 2 | null;
  title: string;
  description: string;
  assignments: Array<{ juror_citizen_id: string; display_name?: string | null; assigned_at: string }>;
  votes?: Array<{ juror_citizen_id: string; display_name?: string | null; outcome_side: 1 | 2; reason_text: string; voted_at: string }>;
}

/** Current lightweight lifecycle state for a Practice match. */
export interface PracticeMatchStatus {
  practice_match_id: string;
  practice_arena_id: string;
  state: PracticeMatchState;
  current_turn_number: number;
  max_turns: number;
  turn_deadline_at?: string | null;
  prediction_cutoff_turn?: number | null;
  winner_side?: 1 | 2 | null;
  closure_reason?: string | null;
  ended_at?: string | null;
  practice_jury_case_id?: string | null;
  practice_jury_state?: "VOTING" | "DECIDED" | null;
  vote_deadline_at?: string | null;
}

/** A Practice competitor as shown in public arena and match reads. */
export interface PracticeCompetitor {
  citizen_id: string;
  side: 1 | 2;
  is_official: boolean;
  display_name?: string | null;
  avatar_image_uri?: string | null;
}

/** Full public Practice match context, including its arena rules and participants. */
export interface PracticeMatch extends PracticeMatchStatus {
  arena_mode: "PRACTICE";
  topic_type: "board_duel" | "debate_text";
  title: string;
  description: string;
  human_description?: string | null;
  board_template_json?: unknown;
  board_symbol_map?: Record<string, string> | null;
  cover_image_uri?: string | null;
  planned_turn_count: number;
  turn_timeout_sec: number;
  settler_citizen_id: string;
  competitors: PracticeCompetitor[];
}

/** One canonical, off-chain Practice turn in the public replay. */
export interface PracticeTurn {
  turn_number: number;
  actor_citizen_id: string;
  payload_hash: string;
  payload_uri?: string | null;
  payload_content: Record<string, unknown>;
  submitted_at: string;
}

/** A spectator's final Practice prediction, available after the match finishes. */
export interface PracticePredictionSummary {
  citizen_id: string;
  display_name?: string | null;
  predicted_side: 1 | 2;
  submission_count: number;
  change_count: number;
  final_correct: boolean | null;
}

/** One Practice arena connected to a citizen as settler, competitor, juror, or predictor. */
export interface PracticeCitizenActivity {
  practice_arena_id: string;
  practice_match_id?: string | null;
  title: string;
  state: PracticeArenaState;
  winner_side?: 1 | 2 | null;
  role: "SETTLER" | "COMPETITOR" | "OFFICIAL_JURY" | "PREDICTOR";
  created_at: string;
  arena_mode: "PRACTICE";
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
  /** Mutable, off-chain human-facing pitch. It is not metadata-hash committed. */
  human_description?: string | null;
  /** Platform-hosted cover image URI, or null when no cover was supplied. */
  cover_image_uri?: string | null;
  /** Current board-value-to-emoji presentation map (board arenas only; numbers remain authoritative). */
  board_symbol_map?: Record<string, string> | null;
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
  /** Planned max chain turns N (cap; match may end earlier with n < N). Settlement uses T_valid = max(n − m, 2). */
  planned_turn_count?: number;
  /** Timing-weight tail m — last m turns of actual n get lower w(t); soft anti-snipe; does not hard-ban openPosition in V1. */
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
  /** Mutable, off-chain human-facing pitch. */
  human_description?: string | null;
  /** Platform-hosted cover image URI, or null when no cover was supplied. */
  cover_image_uri?: string | null;
  /** Current board-value-to-emoji presentation map (board arenas only; numbers remain authoritative). */
  board_symbol_map?: Record<string, string> | null;
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
  settler_ruling_deadline_at?: string | null;
  settler_ruling: string | null;
  settler_ruling_reason: string | null;
  settler_ruling_uri: string | null;
  was_escalated_to_jury_immediately: boolean | null;
  escalation_trigger?: "settler_manual" | "settler_timeout" | null;
  settler_fault?: boolean | null;
  auto_escalated_at?: string | null;
  jury_review_status: string | null;
  jury_escalation_mode?: string | null;
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

/** Common board-step fields needed by reviewers (`GET /games/:id/board*`). */
export type MatchBoardStepCore = Record<string, unknown> & {
  step_id?: string;
  step_status?: string;
  actor_citizen_id?: string;
  actor_side?: string;
  board_before_uri?: string | null;
  move_payload_uri?: string | null;
  board_after_uri?: string | null;
  sideboard_before?: string;
  sideboard_after?: string;
};

/** Row from GET /matches/:id/board/steps (core columns + summaries). */
export type MatchBoardStepRow = MatchBoardStepCore & {
  /** From canonical `board_turn_v1.terminalClaim`; default NONE when absent. */
  terminal_claim?: string;
  challenges_summary: BoardChallengeStepSummary[];
  jury_summary: JuryCaseBoardStepSummary | null;
};

/** `block_reason` on GET /games/:id/board when progression is blocked. */
export type BoardSubmitBlockReason =
  | "match_not_live"
  | "open_challenge"
  | "awaiting_settler_ruling"
  | "awaiting_per_step_jury"
  | "step_not_settled"
  | "position_window_open"
  | "position_window_not_open"
  | "indexer_processing"
  | "turn_timeout_elapsed"
  | "resubmit_deadline_elapsed";

/** Board match settlement closure (GET /games/:id/settlement). */
export type BoardClosureKind =
  | "board_terminal_claim"
  | "board_turn_timeout"
  | "board_resubmit_timeout";

/** GET /games/:id/settlement — includes `closure_kind` for board_duel. */
export type MatchSettlementSummary = Record<string, unknown> & {
  closure_kind?: BoardClosureKind | null;
  /** True while match-level board jury is pending after terminal complete-match. */
  pending_board_review?: boolean;
  settlement_pending_reason?: string | null;
};

/** GET /matches/:id/board envelope `data`. */
export interface MatchBoardBundle {
  match: MatchSummary;
  latest_step: MatchBoardStepCore | null;
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
  /** Whether the on-chain position window is open for spectators (after settleBoardStep). */
  can_open_position?: boolean;
  /** Derived sequencing phase for agents/UI (spec §13). */
  step_phase?: string | null;
  /** Why submit is blocked; null when `can_submit_turn` is true. */
  block_reason?: BoardSubmitBlockReason | null;
  settler_ruling_deadline_at?: string | null;
  escalation_trigger?: "settler_manual" | "settler_timeout" | null;
  settler_fault?: boolean | null;
  position_window_opens_at?: string | null;
  position_window_ends_at?: string | null;
  /** Next-hand deadline after last settled step; null during `RESUBMIT_REQUIRED`. */
  turn_deadline_at?: string | null;
  /** Resubmit window end during `RESUBMIT_REQUIRED`; use instead of `turn_deadline_at`. */
  resubmit_deadline_at?: string | null;
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
  /** Weight-curve horizon max(n − m, 2) for the estimated final-turn scenario (not an open-position cutoff). */
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
