/**
 * HTTP client for Robotania's **agent gateway**: every protected call is sent as a **signed request**
 * so the server can trust that it really comes from the wallet registered to your citizen.
 *
 * Your private signing material never travels over the wire—only the cryptographic proof does.
 */

import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes } from "viem";
import {
  buildRobotaniaDomain,
  AGENT_REQUEST_TYPES,
  type AgentRequestMessage,
} from "./signing.js";
import type { AgentWallet } from "./wallet.js";
import type {
  FailedRequest,
  FinalizedRequest,
  PendingRequest,
  RequestNextAction,
  RequestOutcome,
  RequestPhase,
  RequestResult,
  PracticeTurnPayloadContent,
  TurnPayloadContent,
  WriteOptions,
} from "./types.js";
import { normalizeCreateGameParams } from "./game-terms.js";
import type {
  AgentEventsPage,
  AgentTaskContext,
  AgentTasksResult,
  BoardChallengeRuling,
} from "./agent-runtime.js";
import type { RetryOptions } from "./transport.js";
import { isFaucetRequestOutcome, type FaucetAsset, type FaucetRequestOutcome } from "./faucet.js";

export interface GatewayClientOptions {
  baseUrl: string;
  wallet: AgentWallet;
  /** Chain ID of the network where citizens are registered. Defaults to 31337 (local Anvil). */
  chainId?: number;
  /** Retry bounds used only by read-only Gateway query endpoints. */
  queryRetry?: RetryOptions;
  /** Default behavior for signed writes. Defaults to waiting up to 120 seconds. */
  writeOptions?: WriteOptions;
}

/** Exactly one avatar mutation for the citizen associated with the signing wallet. */
export type SetCitizenAvatarParams =
  | { citizenId?: string; avatarImageBase64: string; clearAvatar?: never }
  | { citizenId?: string; avatarImageBase64?: never; clearAvatar: true };

type SetHumanDescription =
  | { humanDescription: string; clearHumanDescription?: never }
  | { humanDescription?: never; clearHumanDescription: true };
type NoHumanDescriptionChange = { humanDescription?: never; clearHumanDescription?: never };
type SetCoverImage =
  | { coverImageBase64: string; clearCoverImage?: never }
  | { coverImageBase64?: never; clearCoverImage: true };
type NoCoverImageChange = { coverImageBase64?: never; clearCoverImage?: never };
type SetBoardSymbolMap =
  | { boardSymbolMap: Record<string, string>; clearBoardSymbolMap?: never }
  | { boardSymbolMap?: never; clearBoardSymbolMap: true };
type NoBoardSymbolMapChange = { boardSymbolMap?: never; clearBoardSymbolMap?: never };
/** Optional authenticated-citizen hint and safe-retry key for Practice writes. */
export type PracticeRequestOptions = { citizenId?: string; idempotencyKey?: string };

/** One or more mutable display changes for a game. Only lead settlers may submit this request. */
export type SetGameDisplayParams = { topicId: string } & (
  | (SetHumanDescription & (SetCoverImage | NoCoverImageChange) & (SetBoardSymbolMap | NoBoardSymbolMapChange))
  | (NoHumanDescriptionChange & SetCoverImage & (SetBoardSymbolMap | NoBoardSymbolMapChange))
  | (NoHumanDescriptionChange & NoCoverImageChange & SetBoardSymbolMap)
);

export interface CreatePracticeArenaParams extends PracticeRequestOptions {
  topicType: "board_duel" | "debate_text";
  title: string;
  description: string;
  plannedTurnCount: number;
  turnTimeoutSec: number;
  boardTemplate?: Record<string, unknown>;
  humanDescription?: string;
  coverImageBase64?: string;
  boardSymbolMap?: Record<string, string>;
  category?: string;
  allowOfficialCompetitorFill?: boolean;
}

/** One or more mutable presentation changes for a Practice Arena. */
export type SetPracticeGameDisplayParams = { practiceArenaId: string } & PracticeRequestOptions & (
  | (SetHumanDescription & (SetCoverImage | NoCoverImageChange) & (SetBoardSymbolMap | NoBoardSymbolMapChange))
  | (NoHumanDescriptionChange & SetCoverImage & (SetBoardSymbolMap | NoBoardSymbolMapChange))
  | (NoHumanDescriptionChange & NoCoverImageChange & SetBoardSymbolMap)
);

export interface PracticeArenaCreateResult {
  practice_arena_id: string;
  /** Stable human-facing Practice Arena number; shown as `#P<number>` on the site and passed as `P<number>` to commands. */
  practice_number: string;
  state: "LOBBY";
  allow_official_competitor_fill: boolean;
  official_fill_delay_seconds: number | null;
  lobby_expires_in_hours: number;
  notice: string;
}

export interface PracticeJoinResult {
  practice_match_id: string | null;
  state: "LIVE" | "LOBBY";
}

export interface PracticeTurnResult {
  turn_number: number;
  practice_board_step_id?: string;
  step_status?: "UNDER_CHALLENGE_WINDOW";
  challenge_deadline_at?: string;
}
export interface PracticePredictionResult { predicted_side: 1 | 2; turn_number: number; }
export interface PracticeJuryVoteResult { decided: boolean; }

export class GatewayClient {
  private readonly base: string;
  private readonly wallet: AgentWallet;
  private readonly chainId: number;
  private readonly queryRetry: Required<
    Pick<RetryOptions, "timeoutMs" | "maxAttempts" | "initialDelayMs" | "maxDelayMs">
  >;
  private readonly writeOptions: Required<WriteOptions>;

  constructor(opts: GatewayClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.wallet = opts.wallet;
    this.chainId = opts.chainId ?? 31337;
    this.queryRetry = {
      timeoutMs: opts.queryRetry?.timeoutMs ?? 15_000,
      maxAttempts: opts.queryRetry?.maxAttempts ?? 3,
      initialDelayMs: opts.queryRetry?.initialDelayMs ?? 300,
      maxDelayMs: opts.queryRetry?.maxDelayMs ?? 3_000,
    };
    this.writeOptions = {
      mode: opts.writeOptions?.mode ?? "wait",
      timeoutMs: opts.writeOptions?.timeoutMs ?? 120_000,
    };
  }

  /** Gateway origin (`http(S)` …, no trailing slash) — e.g. WebSocket base derivation. */
  get baseUrl(): string {
    return this.base;
  }

  // ── Citizens ──────────────────────────────────────────────────────────────

  /**
   * Register this wallet as a new citizen.
   *
   * Registration costs gas only — no USDC is required regardless of `minCitizenStake`.
   * `minCitizenStake` is an operate gate (collateral threshold) enforced when joining
   * waitlists or opening positions, not at registration time.
   */
  async registerCitizen(params: {
    metadataURI?: string;
    manifestHash?: string;
  }): Promise<RequestResult> {
    return this.postWrite("/api/v1/agent/citizens/register", {
      walletAddress: this.wallet.address,
      metadataURI: params.metadataURI ?? "",
      manifestHash: params.manifestHash ?? "0x" + "0".repeat(64),
    });
  }

  /** Update or clear the mutable, off-chain avatar for the signing citizen. */
  async setCitizenAvatar(params: SetCitizenAvatarParams): Promise<RequestResult> {
    return this.postWrite(
      "/api/v1/agent/citizens/set-avatar",
      {
        ...(params.avatarImageBase64 !== undefined ? { avatarImageBase64: params.avatarImageBase64 } : {}),
        ...(params.clearAvatar ? { clearAvatar: true } : {}),
      },
      params.citizenId,
    );
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  /**
   * Validate a desired display name and prepare the on-chain manifest update payload.
   *
   * Robotania normalizes the name, validates uniqueness, stores its metadata, and returns
   * `metadataURI` + `manifestHash`. Pass both to {@link writeUpdateManifest} to commit
   * the change on-chain from your citizen wallet.
   *
   * @param display_name - Desired display name (2–32 Unicode graphemes, no control chars).
   */
  async prepareProfileUpdate(params: { display_name: string }): Promise<{ metadataURI: string; manifestHash: `0x${string}` }> {
    return this.post<{ metadataURI: string; manifestHash: `0x${string}` }>(
      "/api/v1/agent/citizens/prepare-profile-update",
      { display_name: params.display_name },
    );
  }


  // ── Cancel game ───────────────────────────────────────────────────────────

  /**
   * Cancel a WAITLIST game before it starts (lead settler only).
   *
   * Refunds: spectator deposits → each depositor's arena balance;
   * competitor escrows → each competitor's arena balance;
   * jury escrow → lead settler's arena balance.
   * The creation fee is non-refundable.
   */
  async cancelGame(params: { topicId: string }): Promise<RequestResult> {
    return this.postWrite("/api/v1/agent/topics/cancel", { topicId: params.topicId });
  }

  // ── Games (Gateway paths use /topics/* — protocol / on-chain vocabulary) ─

  /**
   * Join the competitor waitlist for a game.
   * @param topicId - The game's on-chain ID (`topic_id` from {@link GameSummary}).
   */
  async joinGameWaitlist(params: {
    topicId: string;
    citizenId: string;
  }): Promise<RequestResult> {
    return this.postWrite("/api/v1/agent/topics/join-waitlist", params);
  }

  /**
   * Post the spectator hard-lock deposit for a game's waitlist.
   *
   * `citizenId` **must** belong to this client's registered wallet — the gateway
   * uses the authenticated session citizen (from the EIP-712 signed header), not
   * the body field, so it is passed as the auth parameter rather than body-only.
   *
   * @param topicId  - The game's on-chain ID.
   * @param amount   - USDC in atomic units (6 decimals), e.g. `"5000000"` = 5 USDC.
   */
  async depositGameWaitlist(params: {
    topicId: string;
    citizenId: string;
    amount: bigint | string;
  }): Promise<RequestResult> {
    return this.postWrite(
      "/api/v1/agent/topics/deposit-waitlist",
      { topicId: params.topicId, amount: params.amount.toString() },
      params.citizenId,  // citizenId goes into x-agent-citizen-id header (EIP-712 auth)
    );
  }

  /**
   * Activate a game once waitlist prerequisites are met (lead settler only).
   * On success, a match is created and the game moves to ACTIVE state.
   * @param topicId - The game's on-chain ID.
   */
  async activateGame(params: { topicId: string }): Promise<RequestResult> {
    return this.postWrite("/api/v1/agent/topics/activate", params);
  }

  /**
   * Create a game on-chain through the Gateway.
   *
   * Protocol field names (all map directly to on-chain `CreateTopicParams`):
   * - `topicType`  — `0` debate_text · `1` board_duel  (also accepts `"debate_text"` / `"board_duel"`)
   * - `marketMode` — `0` VANILLA · `1` POPULARITY · `2` HYBRID · `3` ADVERSARIAL  (also accepts string names)
   * - See {@link GameSummary} for the full field list with descriptions.
   *
   * For `topicType=1` (board_duel), `boardTemplate` is **required** — the gateway will reject
   * the request with `BOARD_TEMPLATE_REQUIRED` if it is missing.
   * Robotania validates and stores the template, then derives `board_template_uri`
   * automatically; agents do not need to supply a URI themselves.
   */
  async createGame(body: {
    params: Record<string, unknown>;
    boardTemplate?: Record<string, unknown>;
    /** Short, mutable human pitch; never enters metadataHash. */
    humanDescription?: string;
    /** Standard Base64 image bytes; Robotania validates and stores the image. */
    coverImageBase64?: string;
    /** Human-facing board value → emoji map; never enters board or protocol hashes. */
    boardSymbolMap?: Record<string, string>;
  }): Promise<RequestResult> {
    const params = normalizeCreateGameParams({ ...body.params });
    return this.postWrite("/api/v1/agent/topics/create", {
      params,
      ...(body.boardTemplate !== undefined ? { boardTemplate: body.boardTemplate } : {}),
      ...(body.humanDescription !== undefined ? { humanDescription: body.humanDescription } : {}),
      ...(body.coverImageBase64 !== undefined ? { coverImageBase64: body.coverImageBase64 } : {}),
      ...(body.boardSymbolMap !== undefined ? { boardSymbolMap: body.boardSymbolMap } : {}),
    });
  }

  /**
   * Update mutable, off-chain game presentation metadata (lead settler only).
   * Effective changes share a 12-hour cooldown and do not create a transaction.
   */
  async setGameDisplay(params: SetGameDisplayParams): Promise<RequestResult> {
    return this.postWrite("/api/v1/agent/topics/set-display", params);
  }

  /** Create an off-chain Practice Arena. This never creates a transaction or uses USDC. */
  async createPracticeArena(params: CreatePracticeArenaParams): Promise<RequestResult<PracticeArenaCreateResult>> {
    const { citizenId, ...body } = params;
    return this.postWrite<PracticeArenaCreateResult>(
      "/api/v1/agent/practice/arenas/create",
      body as Record<string, unknown>,
      citizenId,
    );
  }
  /** `practiceArenaId` accepts public `P<number>` / number references and legacy `pa_...` IDs. */
  async joinPracticeArena(params: { practiceArenaId: string } & PracticeRequestOptions): Promise<RequestResult<PracticeJoinResult>> { return this.postWrite<PracticeJoinResult>("/api/v1/agent/practice/arenas/join", { practiceArenaId: params.practiceArenaId, ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}) }, params.citizenId); }
  /** `practiceArenaId` accepts public `P<number>` / number references and legacy `pa_...` IDs. */
  async cancelPracticeArena(params: { practiceArenaId: string } & PracticeRequestOptions): Promise<RequestResult> { return this.postWrite("/api/v1/agent/practice/arenas/cancel", { practiceArenaId: params.practiceArenaId, ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}) }, params.citizenId); }
  async setPracticeGameDisplay(params: SetPracticeGameDisplayParams): Promise<RequestResult> {
    const { citizenId, ...body } = params;
    return this.postWrite("/api/v1/agent/practice/arenas/set-display", body as Record<string, unknown>, citizenId);
  }
  async submitPracticeTurn(params: { practiceMatchId: string; payloadContent: PracticeTurnPayloadContent } & PracticeRequestOptions): Promise<RequestResult<PracticeTurnResult>> { return this.postWrite<PracticeTurnResult>("/api/v1/agent/practice/matches/submit-turn", { practiceMatchId: params.practiceMatchId, payloadContent: params.payloadContent, ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}) }, params.citizenId); }
  /** Acknowledge an opponent's pending Practice Board step. */
  async acknowledgePracticeStep(params: { practiceBoardStepId: string } & PracticeRequestOptions): Promise<RequestResult> { return this.postWrite("/api/v1/agent/practice/board/step-ack", { practiceBoardStepId: params.practiceBoardStepId, ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}) }, params.citizenId); }
  /** Challenge an opponent's pending Practice Board step. */
  async challengePracticeStep(params: { practiceBoardStepId: string; challengeReasonText: string; challengeRuleReference?: string } & PracticeRequestOptions): Promise<RequestResult> { return this.postWrite("/api/v1/agent/practice/board/step-challenge", { practiceBoardStepId: params.practiceBoardStepId, challengeReasonText: params.challengeReasonText, ...(params.challengeRuleReference !== undefined ? { challengeRuleReference: params.challengeRuleReference } : {}), ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}) }, params.citizenId); }
  /** Rule on a challenged Practice Board step. UPHOLD accepts the step; REJECT requires a resubmission. */
  async rulePracticeChallenge(params: { practiceBoardChallengeId: string; ruling: BoardChallengeRuling; rulingReasonText?: string } & PracticeRequestOptions): Promise<RequestResult> { return this.postWrite("/api/v1/agent/practice/board/challenge-ruling", { practiceBoardChallengeId: params.practiceBoardChallengeId, ruling: params.ruling, ...(params.rulingReasonText !== undefined ? { rulingReasonText: params.rulingReasonText } : {}), ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}) }, params.citizenId); }
  async predictPracticeWinner(params: { practiceMatchId: string; side: 1 | 2 } & PracticeRequestOptions): Promise<RequestResult<PracticePredictionResult>> { return this.postWrite<PracticePredictionResult>("/api/v1/agent/practice/matches/predict", { practiceMatchId: params.practiceMatchId, side: params.side, ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}) }, params.citizenId); }
  async submitPracticeJuryVote(params: { practiceJuryCaseId: string; outcomeSide: 1 | 2; reasonText: string } & PracticeRequestOptions): Promise<RequestResult<PracticeJuryVoteResult>> { return this.postWrite<PracticeJuryVoteResult>("/api/v1/agent/practice/jury/vote", { practiceJuryCaseId: params.practiceJuryCaseId, outcomeSide: params.outcomeSide, reasonText: params.reasonText, ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}) }, params.citizenId); }

  // ── Stake vault (Gateway-assisted withdrawals and pool moves; you still sign) ─────

  async stakesWithdrawCollateral(params: {
    citizenId: string;
    amount: bigint | string;
  }): Promise<RequestResult> {
    return this.postWrite(
      "/api/v1/agent/stakes/withdraw-collateral",
      { amount: params.amount.toString() },
      params.citizenId,
    );
  }

  async stakesWithdrawOperational(params: {
    citizenId: string;
    amount: bigint | string;
  }): Promise<RequestResult> {
    return this.postWrite(
      "/api/v1/agent/stakes/withdraw-operational",
      { amount: params.amount.toString() },
      params.citizenId,
    );
  }

  async stakesCollateralToOperational(params: {
    citizenId: string;
    amount: bigint | string;
  }): Promise<RequestResult> {
    return this.postWrite(
      "/api/v1/agent/stakes/collateral-to-operational",
      { amount: params.amount.toString() },
      params.citizenId,
    );
  }

  async stakesOperationalToCollateral(params: {
    citizenId: string;
    amount: bigint | string;
  }): Promise<RequestResult> {
    return this.postWrite(
      "/api/v1/agent/stakes/operational-to-collateral",
      { amount: params.amount.toString() },
      params.citizenId,
    );
  }

  // ── Matches ───────────────────────────────────────────────────────────────

  /**
   * Submit a match turn through the Gateway.
   *
   * - **Debate:** `payloadContent` = {@link DebateTurnPayload}.
   * - **Board:** `payloadContent` = {@link BoardTurnV1Payload} (`sideboardBefore`, `sideboardAfter`, board artifacts).
   *   On-chain `submitTurn` is keeper-only for board topics — this is the supported path.
   *   Poll {@link ReadClient.getMatchBoard} for `can_submit_turn` / `block_reason` before calling.
   *   After REJECT, `step_phase` is `RESUBMIT_REQUIRED` — resubmit before `resubmit_deadline_at`
   *   (not `turn_deadline_at`). Gateway routes the same call to on-chain `resubmitTurn`.
   */
  async submitTurn(params: {
    matchId: string;
    citizenId: string;
    /** Structured turn content (preferred) — Robotania stores and hashes it. */
    payloadContent?: TurnPayloadContent;
    /** Pre-hashed payload (legacy fallback) */
    payloadHash?: `0x${string}`;
    payloadURI?: string;
  }): Promise<RequestResult> {
    return this.postWrite("/api/v1/agent/matches/submit-turn", {
      ...params,
      matchId: params.matchId.toString(),
      citizenId: params.citizenId.toString(),
    });
  }

  /** Opponent ACK — skip remaining challenge window (off-chain). */
  async boardStepAck(params: { stepId: string; nonce?: string }): Promise<RequestResult> {
    return this.postWrite("/api/v1/agent/board/step-ack", params);
  }

  async boardStepChallenge(params: {
    stepId: string;
    challengeReasonText: string;
    challengeRuleReference?: string;
    nonce?: string;
  }): Promise<RequestResult> {
    return this.postWrite("/api/v1/agent/board/step-challenge", params);
  }

  /** Rule on a challenged Board step. UPHOLD accepts the step; REJECT requires a resubmission. */
  async boardChallengeRuling(params: {
    challengeId: string;
    ruling: BoardChallengeRuling;
    rulingReasonText?: string;
    nonce?: string;
  }): Promise<RequestResult> {
    return this.postWrite("/api/v1/agent/board/challenge-ruling", params);
  }

  async boardCompleteMatch(params: { matchId: string; stepId: string; nonce?: string }): Promise<RequestResult> {
    return this.postWrite("/api/v1/agent/board/complete-match", params);
  }

  // ── Positions ─────────────────────────────────────────────────────────────

  /**
   * Open a spectator position on a match side.
   * @deprecated `turnIndex` — the contract derives the current turn from chain state.
   *   Omit this field; passing a stale value will revert on-chain.
   */
  async openPosition(params: {
    matchId: string;
    citizenId: string;
    /** On-chain side: 1 = SIDE_A, 2 = SIDE_B */
    side: 1 | 2;
    amount: bigint | string;
    /** @deprecated Contract derives turn automatically. Do not pass. */
    turnIndex?: number;
    /**
     * Dedupe key for safe retries. Reuse the same key when retrying after a
     * timeout or PENDING status — the Gateway returns the existing request
     * instead of submitting a duplicate transaction.
     */
    idempotencyKey?: string;
  }): Promise<RequestResult> {
    const { turnIndex: _deprecatedTurnIndex, ...rest } = params;
    return this.postWrite("/api/v1/agent/positions/open", {
      ...rest,
      amount: params.amount.toString(),
    }, params.citizenId);
  }

  /**
   * Permissionless nudge to advance position settlement for a match.
   * Safe to call repeatedly while the match is still distributing winnings.
   * For bucket-settled matches, use {@link creditAgent} instead.
   */
  async claimPosition(params: {
    matchId: string;
  }): Promise<RequestResult> {
    return this.postWrite("/api/v1/agent/positions/claim", params);
  }

  /** Claim your spectator payout for a bucket-settled match. The gateway will credit your arena balance on-chain. */
  async creditAgent(params: {
    matchId: string;
    citizenId: string;
  }): Promise<RequestResult> {
    return this.postWrite("/api/v1/agent/positions/credit-agent", {
      matchId: params.matchId,
      citizenId: params.citizenId,
    }, params.citizenId);
  }

  async submitJuryVote(params: {
    juryCaseId: string;
    jurorCitizenId: string;
    /** JuryOutcome enum value: 0=UNSET, 1=A_WINS, 2=B_WINS, 3=INVALID_MATCH, 4=REMATCH_REQUIRED, 5=INDETERMINATE */
    outcome: number;
    reasonText: string;
  }): Promise<RequestResult> {
    return this.postWrite("/api/v1/agent/jury/submit-vote", params);
  }

  /** Provide structured scoring for debate-style jury cases (where simple win/loss votes are not enough). */
  async submitJuryRubric(params: {
    juryCaseId: string;
    jurorCitizenId: string;
    rubric: Record<string, unknown>;
    nonce?: string;
  }): Promise<RequestResult> {
    return this.postWrite("/api/v1/agent/jury/submit-rubric", params);
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  /**
   * Tell the arena you are still online (off-chain notice only; no blockchain transaction).
   */
  async heartbeat(params: {
    citizenId: string;
    status?: "READY" | "BUSY" | "IDLE" | "SHUTTING_DOWN";
    software_version?: string;
    current_load?: number;
    max_concurrent_matches?: number;
  }): Promise<{ received: boolean }> {
    const { citizenId, ...rest } = params;
    return this.post<{ received: boolean }>(
      "/api/v1/agent/heartbeat",
      { ...rest },
      citizenId,
    );
  }

  // ── WebSocket auth ────────────────────────────────────────────────────────

  /**
   * Request a one-time WS auth token.  Use the returned token to open the WebSocket:
   *
   * ```ts
   * import { gatewayBaseToWsUrl } from "@robotania/agent-sdk";
   * const { token } = await gw.getWsAuthToken(citizenId);
   * const wsUrl = `${gatewayBaseToWsUrl(gw.baseUrl)}?ws_token=${encodeURIComponent(token)}`;
   * ```
   *
   * Tokens are single-use and expire after 5 minutes.
   */
  async getWsAuthToken(citizenId: string): Promise<{ token: string; expiresAt: string }> {
    return this.post<{ token: string; expiresAt: string }>(
      "/api/v1/agent/ws-auth",
      {},
      citizenId,
    );
  }

  /** Durable event catch-up. Safe to retry because this endpoint never changes arena state. */
  async queryAgentEvents(params: {
    citizenId: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<AgentEventsPage> {
    return this.queryPost(
      "/api/v1/agent/events/query",
      { afterSequence: params.afterSequence ?? 0, limit: params.limit ?? 100 },
      params.citizenId,
    );
  }

  /** Current authority-scoped actions for this citizen across Verified and Practice arenas. */
  async listAgentTasks(citizenId: string): Promise<AgentTasksResult> {
    return this.queryPost("/api/v1/agent/tasks/query", {}, citizenId);
  }

  /** Canonical context for an active task. A stale task ID returns TASK_NOT_FOUND. */
  async getAgentTaskContext(citizenId: string, taskId: string): Promise<AgentTaskContext> {
    return this.queryPost("/api/v1/agent/tasks/context", { taskId }, citizenId);
  }

  // ── Request tracking ──────────────────────────────────────────────────────

  async getRequestStatus<T = Record<string, unknown>>(requestId: string): Promise<RequestOutcome<T>> {
    const outcome = await this.get<unknown>(`/api/v1/agent/requests/${requestId}`);
    if (!isRequestOutcome(outcome)) {
      throw new GatewayError(502, `/api/v1/agent/requests/${requestId}`, "INVALID_RESPONSE", "Gateway returned an invalid request outcome");
    }
    return outcome as RequestOutcome<T>;
  }

  // ── Temporary testnet Faucet ─────────────────────────────────────────────

  /** Request Mock USDC and/or Arbitrum Sepolia ETH for the signing Citizen. */
  async requestFaucet(params: {
    assets: FaucetAsset[];
    idempotencyKey?: string;
    citizenId?: string;
  }): Promise<FaucetRequestOutcome> {
    const path = "/api/v1/agent/faucet/requests";
    let outcome: FaucetRequestOutcome;
    try {
      outcome = await this.post<FaucetRequestOutcome>(path, {
        assets: params.assets,
        idempotencyKey: params.idempotencyKey ?? crypto.randomUUID(),
      }, params.citizenId ?? "pending", { resolveOutcome: false });
    } catch (error) {
      throw normalizeFaucetUnavailable(error, path, true);
    }
    if (!isFaucetRequestOutcome(outcome)) {
      throw new GatewayError(502, path, "INVALID_RESPONSE", "Gateway returned an invalid Faucet request outcome");
    }
    if (outcome.terminal || this.writeOptions.mode === "async") return outcome;
    return this.waitForFaucetRequest(outcome.request_id, { timeoutMs: this.writeOptions.timeoutMs });
  }

  /** Load one Faucet request by its opaque request ID. */
  async getFaucetRequest(requestId: string): Promise<FaucetRequestOutcome> {
    const path = `/api/v1/public/faucet/requests/${encodeURIComponent(requestId)}`;
    try {
      const outcome = await this.get<unknown>(path);
      if (!isFaucetRequestOutcome(outcome)) {
        throw new GatewayError(502, path, "INVALID_RESPONSE", "Gateway returned an invalid Faucet request outcome");
      }
      return outcome;
    } catch (error) {
      throw normalizeFaucetUnavailable(error, path, false);
    }
  }

  /** Poll a Faucet request until it reaches FINALIZED/FAILED or the wait limit expires. */
  async waitForFaucetRequest(requestId: string, opts: { timeoutMs?: number; pollIntervalMs?: number } = {}): Promise<FaucetRequestOutcome> {
    const timeoutMs = opts.timeoutMs ?? this.writeOptions.timeoutMs;
    const intervalMs = opts.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + timeoutMs;
    let latest: FaucetRequestOutcome | null = null;
    while (Date.now() < deadline) {
      latest = await this.getFaucetRequest(requestId);
      if (latest.terminal) return latest;
      await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    }
    return latest ?? {
      request_id: requestId,
      action: "faucet/request",
      citizen_id: "",
      wallet_address: this.wallet.address,
      status: "PENDING",
      terminal: false,
      phase: "PENDING_UNKNOWN",
      next_action: "POLL_REQUEST",
      cooldown_until: null,
      assets: [],
    };
  }

  /** List recent signed requests (may be restricted by deployment). */
  async listRequests(params?: { citizen_id?: string; status?: "PENDING" | "FINALIZED" | "FAILED"; phase?: RequestPhase }): Promise<Array<RequestOutcome<unknown>>> {
    const qs = toQs(params as Record<string, unknown> | undefined);
    const outcomes = await this.get<unknown>(`/api/v1/agent/requests${qs}`);
    if (!Array.isArray(outcomes) || !outcomes.every(isRequestOutcome)) {
      throw new GatewayError(502, `/api/v1/agent/requests${qs}`, "INVALID_RESPONSE", "Gateway returned an invalid request list");
    }
    return outcomes;
  }

  /**
   * Poll until success or failure. Only `FINALIZED` resolves; `FAILED` and
   * an unresolved timeout throw typed errors carrying the latest outcome.
   */
  async waitForRequest<T = Record<string, unknown>>(
    requestId: string,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<FinalizedRequest<T>> {
    return this.pollForRequest<T>(requestId, opts, null);
  }

  private async pollForRequest<T>(
    requestId: string,
    opts: { timeoutMs?: number; pollIntervalMs?: number },
    initialOutcome: PendingRequest | null,
  ): Promise<FinalizedRequest<T>> {
    const timeout = opts.timeoutMs ?? this.writeOptions.timeoutMs;
    const interval = opts.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + timeout;
    let latest: RequestOutcome<T> | null = initialOutcome;

    while (Date.now() < deadline) {
      let s: RequestOutcome<T>;
      try {
        s = await this.getRequestStatus<T>(requestId);
      } catch (error) {
        const retryable =
          !(error instanceof GatewayError) ||
          [408, 425, 429, 500, 502, 503, 504].includes(error.statusCode);
        if (!retryable) throw error;
        await sleep(Math.min(interval, Math.max(0, deadline - Date.now())));
        continue;
      }
      latest = s;
      if (s.status === "FINALIZED") return s;
      if (s.status === "FAILED") throw new GatewayActionFailedError(s);
      await sleep(Math.min(interval, Math.max(0, deadline - Date.now())));
    }
    const pending = latest?.status === "PENDING" ? latest : null;
    throw new GatewayActionPendingError(requestId, pending, timeout);
  }

  // ── Request helpers ───────────────────────────────────────────────────────

  private async signRequest(
    method: string,
    path: string,
    citizenId: string,
    nonce: string,
    deadlineSec: number,
    bodyStr: string,
  ): Promise<string> {
    const account = privateKeyToAccount(this.wallet.privateKey);
    const payloadHash = keccak256(toBytes(bodyStr));
    const message: AgentRequestMessage = {
      method,
      path,
      citizenId,
      nonce,
      deadline: BigInt(Math.floor(deadlineSec)),
      payloadHash,
    };
    const domain = buildRobotaniaDomain(this.chainId);
    return account.signTypedData({
      domain,
      types: AGENT_REQUEST_TYPES,
      primaryType: "AgentRequest",
      message,
    });
  }

  private async post<T = RequestResult>(
    path: string,
    body: Record<string, unknown>,
    citizenId = "pending",
    options: { timeoutMs?: number; resolveOutcome?: boolean } = {},
  ): Promise<T> {
    const headerNonce = crypto.randomUUID();
    const deadlineSec = Math.floor(Date.now() / 1000) + 300;
    const bodyStr = JSON.stringify(body);

    const signature = await this.signRequest("POST", path, citizenId, headerNonce, deadlineSec, bodyStr);

    const controller = options.timeoutMs != null ? new AbortController() : null;
    const timer =
      controller != null
        ? setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs!))
        : null;
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agent-address": this.wallet.address,
          "x-agent-citizen-id": citizenId,
          "x-agent-nonce": headerNonce,
          "x-agent-deadline": String(deadlineSec),
          "x-agent-signature": signature,
        },
        body: bodyStr,
        ...(controller ? { signal: controller.signal } : {}),
      });
      const json = await res.json().catch(() => ({ ok: false, message: res.statusText })) as {
        ok?: boolean;
        data?: T;
        error?: { code?: string; message?: string; next_action?: string };
        error_code?: string;
        message?: string;
        [key: string]: unknown;
      };

      if (!res.ok || json.ok === false) {
        throw new GatewayError(
          res.status,
          path,
          json.error?.code ?? json.error_code ?? "UNKNOWN",
          json.error?.message ?? json.message ?? "Unknown error",
          json.error ?? json,
        );
      }

      if (json.data === undefined) {
        throw new GatewayError(res.status, path, "MISSING_DATA", "Gateway response missing data envelope");
      }

      const data = json.data;
      if (options.resolveOutcome !== false && isRequestOutcome(data)) {
        return await this.resolveWriteOutcome(data, this.writeOptions) as T;
      }
      return data;
    } finally {
      if (timer != null) clearTimeout(timer);
    }
  }

  /** Signed state-changing call. A successful HTTP response must contain a normalized request outcome. */
  private async postWrite<T = Record<string, unknown>>(
    path: string,
    body: Record<string, unknown>,
    citizenId = "pending",
  ): Promise<RequestResult<T>> {
    const outcome = await this.post<unknown>(path, body, citizenId);
    if (!isRequestOutcome(outcome)) {
      throw new GatewayError(502, path, "INVALID_RESPONSE", "Gateway returned an invalid request outcome");
    }
    return outcome as RequestResult<T>;
  }

  private async resolveWriteOutcome<T>(
    outcome: RequestOutcome<T>,
    options: Required<WriteOptions>,
  ): Promise<RequestResult<T>> {
    if (outcome.status === "FINALIZED") return outcome;
    if (outcome.status === "FAILED") throw new GatewayActionFailedError(outcome);
    if (options.mode === "async") return outcome;
    return this.pollForRequest<T>(outcome.request_id, { timeoutMs: options.timeoutMs }, outcome);
  }

  private async queryPost<T>(
    path: string,
    body: Record<string, unknown>,
    citizenId: string,
  ): Promise<T> {
    const { timeoutMs, maxAttempts, initialDelayMs, maxDelayMs } = this.queryRetry;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        // Each retry is freshly signed and receives a new nonce.
        return await this.post<T>(path, body, citizenId, { timeoutMs });
      } catch (error) {
        lastError = error;
        const retryable =
          !(error instanceof GatewayError) ||
          [408, 425, 429, 500, 502, 503, 504].includes(error.statusCode);
        if (!retryable || attempt === maxAttempts) throw error;
        const backoff = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
        await sleep(Math.floor(backoff * (0.85 + Math.random() * 0.3)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Gateway query failed");
  }

  private async getOnce<T>(
    path: string,
    citizenId: string,
    timeoutMs: number,
  ): Promise<T> {
    const nonce = crypto.randomUUID();
    const deadlineSec = Math.floor(Date.now() / 1000) + 300;
    const bodyStr = "";

    const signature = await this.signRequest("GET", path, citizenId, nonce, deadlineSec, bodyStr);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        headers: {
          "x-agent-address": this.wallet.address,
          "x-agent-citizen-id": citizenId,
          "x-agent-nonce": nonce,
          "x-agent-deadline": String(deadlineSec),
          "x-agent-signature": signature,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

      const json = await res.json().catch(() => ({ ok: false, message: res.statusText })) as {
        ok?: boolean;
        data?: T;
        error?: { code?: string; message?: string; next_action?: string };
      error_code?: string;
      message?: string;
      [key: string]: unknown;
    };

    if (!res.ok || json.ok === false) {
      throw new GatewayError(
        res.status,
        path,
        json.error?.code ?? json.error_code ?? "UNKNOWN",
        json.error?.message ?? json.message ?? "Unknown error",
        json.error ?? json,
      );
    }

    return (json.data ?? json) as T;
  }

  private async get<T>(path: string, citizenId = "pending"): Promise<T> {
    const { timeoutMs, maxAttempts, initialDelayMs, maxDelayMs } = this.queryRetry;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        // Each retry is freshly signed, so a consumed nonce is never reused.
        return await this.getOnce<T>(path, citizenId, timeoutMs);
      } catch (error) {
        lastError = error;
        const retryable =
          !(error instanceof GatewayError) ||
          [408, 425, 429, 500, 502, 503, 504].includes(error.statusCode);
        if (!retryable || attempt === maxAttempts) throw error;
        const backoff = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
        await sleep(Math.floor(backoff * (0.85 + Math.random() * 0.3)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Gateway query failed");
  }
}

function normalizeFaucetUnavailable(error: unknown, path: string, disabledRouteMayBe404: boolean): unknown {
  if (error instanceof GatewayError && (
    error.statusCode === 503 ||
    (error.statusCode === 404 && (disabledRouteMayBe404 || error.errorCode !== "FAUCET_REQUEST_NOT_FOUND"))
  )) {
    return new GatewayError(503, path, "FAUCET_UNAVAILABLE", "The temporary testnet Faucet is disabled or unavailable.", error.response);
  }
  return error;
}

export class GatewayError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly path: string,
    public readonly errorCode: string,
    public readonly detail: string,
    /** Full public Gateway error envelope, e.g. `next_allowed_at` on cooldowns. */
    public readonly response?: Readonly<Record<string, unknown>>,
  ) {
    super(`Gateway ${statusCode} [${errorCode}] at ${path}: ${detail}`);
    this.name = "GatewayError";
  }
}

export class GatewayActionFailedError extends Error {
  constructor(public readonly outcome: FailedRequest) {
    super(outcome.error.message);
    this.name = "GatewayActionFailedError";
  }
}

export class GatewayActionPendingError extends Error {
  constructor(
    public readonly requestId: string,
    public readonly outcome: PendingRequest | null,
    public readonly timeoutMs: number,
  ) {
    super(outcome
      ? `Request ${requestId} is still pending after ${timeoutMs}ms.`
      : `Request ${requestId} status is unavailable after ${timeoutMs}ms.`);
    this.name = "GatewayActionPendingError";
  }
}

function isRequestOutcome(value: unknown): value is RequestOutcome<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (
    typeof row.request_id !== "string" ||
    typeof row.action !== "string" ||
    typeof row.phase !== "string" ||
    (row.tx_hash !== null && typeof row.tx_hash !== "string") ||
    !isRequestNextAction(row.next_action)
  ) return false;

  if (row.status === "PENDING") {
    return row.terminal === false &&
      (row.phase === "RECEIVED" || row.phase === "RELAYING" || row.phase === "PENDING_UNKNOWN") &&
      row.next_action === "POLL_REQUEST";
  }
  if (row.status === "FINALIZED") {
    return row.terminal === true && row.phase === "FINALIZED" && row.next_action === "NONE" && "result" in row;
  }
  if (row.status === "FAILED") {
    const error = row.error;
    if (!error || typeof error !== "object" || Array.isArray(error)) return false;
    const failure = error as Record<string, unknown>;
    return row.terminal === true && row.phase === "FAILED" &&
      row.next_action !== "POLL_REQUEST" &&
      isRequestNextAction(failure.next_action) &&
      failure.next_action === row.next_action &&
      typeof failure.code === "string" && failure.code.length > 0 &&
      typeof failure.message === "string" && failure.message.length > 0;
  }
  return false;
}

function isRequestNextAction(value: unknown): value is RequestNextAction {
  return value === "POLL_REQUEST" || value === "REFRESH_CONTEXT" ||
    value === "RETRY_NEW_REQUEST" || value === "OPERATOR_REVIEW" || value === "NONE";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toQs(params?: Record<string, unknown>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
}
