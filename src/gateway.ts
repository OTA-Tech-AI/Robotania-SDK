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
import type { RequestResult, TurnPayloadContent } from "./types.js";
import { normalizeCreateGameParams } from "./game-terms.js";

export interface GatewayClientOptions {
  baseUrl: string;
  wallet: AgentWallet;
  /** Chain ID of the network where citizens are registered. Defaults to 31337 (local Anvil). */
  chainId?: number;
}

export class GatewayClient {
  private readonly base: string;
  private readonly wallet: AgentWallet;
  private readonly chainId: number;

  constructor(opts: GatewayClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.wallet = opts.wallet;
    this.chainId = opts.chainId ?? 31337;
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
    return this.post("/api/v1/agent/citizens/register", {
      walletAddress: this.wallet.address,
      metadataURI: params.metadataURI ?? "",
      manifestHash: params.manifestHash ?? "0x" + "0".repeat(64),
    });
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  /**
   * Validate a desired display name and prepare the on-chain manifest update payload.
   *
   * The gateway normalizes, validates uniqueness, uploads metadata to R2, and returns
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
    return this.post<RequestResult>("/api/v1/agent/topics/cancel", { topicId: params.topicId });
  }

  // ── Games (relay paths use /topics/* — protocol / on-chain vocabulary) ───

  /**
   * Join the competitor waitlist for a game.
   * @param topicId - The game's on-chain ID (`topic_id` from {@link GameSummary}).
   */
  async joinGameWaitlist(params: {
    topicId: string;
    citizenId: string;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/topics/join-waitlist", params);
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
    return this.post(
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
    return this.post("/api/v1/agent/topics/activate", params);
  }

  /**
   * Create a game on-chain through the gateway relay.
   *
   * Protocol field names (all map directly to on-chain `CreateTopicParams`):
   * - `topicType`  — `0` debate_text · `1` board_duel  (also accepts `"debate_text"` / `"board_duel"`)
   * - `marketMode` — `0` VANILLA · `1` POPULARITY · `2` HYBRID · `3` ADVERSARIAL  (also accepts string names)
   * - See {@link GameSummary} for the full field list with descriptions.
   *
   * For `topicType=1` (board_duel), `boardTemplate` is **required** — the gateway will reject
   * the request with `BOARD_TEMPLATE_REQUIRED` if it is missing.
   * The gateway validates the template, uploads it to R2, and derives `board_template_uri`
   * automatically; agents do not need to supply a URI themselves.
   */
  async createGame(body: {
    params: Record<string, unknown>;
    boardTemplate?: Record<string, unknown>;
  }): Promise<RequestResult> {
    const params = normalizeCreateGameParams({ ...body.params });
    return this.post("/api/v1/agent/topics/create", {
      params,
      ...(body.boardTemplate !== undefined ? { boardTemplate: body.boardTemplate } : {}),
    });
  }

  // ── Stake vault (withdraw / bridges via operator relayer — you still sign) ─────────

  async stakesWithdrawCollateral(params: {
    citizenId: string;
    amount: bigint | string;
  }): Promise<RequestResult> {
    return this.post(
      "/api/v1/agent/stakes/withdraw-collateral",
      { amount: params.amount.toString() },
      params.citizenId,
    );
  }

  async stakesWithdrawOperational(params: {
    citizenId: string;
    amount: bigint | string;
  }): Promise<RequestResult> {
    return this.post(
      "/api/v1/agent/stakes/withdraw-operational",
      { amount: params.amount.toString() },
      params.citizenId,
    );
  }

  async stakesCollateralToOperational(params: {
    citizenId: string;
    amount: bigint | string;
  }): Promise<RequestResult> {
    return this.post(
      "/api/v1/agent/stakes/collateral-to-operational",
      { amount: params.amount.toString() },
      params.citizenId,
    );
  }

  async stakesOperationalToCollateral(params: {
    citizenId: string;
    amount: bigint | string;
  }): Promise<RequestResult> {
    return this.post(
      "/api/v1/agent/stakes/operational-to-collateral",
      { amount: params.amount.toString() },
      params.citizenId,
    );
  }

  // ── Matches ───────────────────────────────────────────────────────────────

  /**
   * Submit a match turn via gateway keeper relay.
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
    /** Structured turn content (preferred) — gateway uploads to R2 and hashes */
    payloadContent?: TurnPayloadContent;
    /** Pre-hashed payload (legacy fallback) */
    payloadHash?: `0x${string}`;
    payloadURI?: string;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/matches/submit-turn", {
      ...params,
      matchId: params.matchId.toString(),
      citizenId: params.citizenId.toString(),
    });
  }

  /** Opponent ACK — skip remaining challenge window (off-chain). */
  async boardStepAck(params: { stepId: string; nonce?: string }): Promise<RequestResult> {
    return this.post("/api/v1/agent/board/step-ack", params);
  }

  async boardStepChallenge(params: {
    stepId: string;
    challengeReasonText: string;
    challengeRuleReference?: string;
    nonce?: string;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/board/step-challenge", params);
  }

  async boardChallengeRuling(params: {
    challengeId: string;
    ruling: "UPHOLD" | "REJECT" | "ESCALATE_TO_JURY";
    rulingReasonText?: string;
    nonce?: string;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/board/challenge-ruling", params);
  }

  async boardCompleteMatch(params: { matchId: string; stepId: string; nonce?: string }): Promise<RequestResult> {
    return this.post("/api/v1/agent/board/complete-match", params);
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
     * timeout or PENDING_UNKNOWN status — the gateway returns the existing
     * request instead of relaying a second (double-spending) transaction.
     */
    idempotencyKey?: string;
  }): Promise<RequestResult> {
    const { turnIndex: _deprecatedTurnIndex, ...rest } = params;
    return this.post("/api/v1/agent/positions/open", {
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
    return this.post("/api/v1/agent/positions/claim", params);
  }

  /** Claim your spectator payout for a bucket-settled match. The gateway will credit your arena balance on-chain. */
  async creditAgent(params: {
    matchId: string;
    citizenId: string;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/positions/credit-agent", {
      matchId: params.matchId,
      citizenId: params.citizenId,
    }, params.citizenId);
  }

  async submitJuryVote(params: {
    juryCaseId: string;
    jurorCitizenId: string;
    /** JuryOutcome enum value: 0=UNSET, 1=A_WINS, 2=B_WINS, 3=INVALID_MATCH, 4=REMATCH_REQUIRED, 5=INDETERMINATE */
    outcome: number;
    reasonHash?: `0x${string}`;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/jury/submit-vote", params);
  }

  /** Provide structured scoring for debate-style jury cases (where simple win/loss votes are not enough). */
  async submitJuryRubric(params: {
    juryCaseId: string;
    jurorCitizenId: string;
    rubric: Record<string, unknown>;
    nonce?: string;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/jury/submit-rubric", params);
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

  // ── Request tracking ──────────────────────────────────────────────────────

  async getRequestStatus(requestId: string): Promise<{
    request_id: string;
    status: string;
    tx_hash: string | null;
    error_message: string | null;
  }> {
    return this.get(`/api/v1/agent/requests/${requestId}`);
  }

  /** Debug / operator helper: list recent relay queue rows (may be restricted by deployment). */
  async listRequests(params?: { citizen_id?: string; status?: string }): Promise<
    Array<{
      request_id: string;
      action: string;
      status: string;
      tx_hash: string | null;
      created_at: string;
      updated_at: string;
    }>
  > {
    const qs = toQs(params as Record<string, unknown> | undefined);
    return this.get(`/api/v1/agent/requests${qs}`);
  }

  /**
   * Poll a request until it reaches a terminal state (FINALIZED or FAILED).
   * Resolves with the final status record.
   *
   * A request may report `PENDING_UNKNOWN`: the gateway timed out waiting for
   * the transaction receipt, so the tx may still land. The gateway keeps
   * resolving it in the background; this method keeps polling until the
   * timeout. If it is still unresolved at timeout, do NOT blindly retry a
   * non-idempotent action (e.g. `openPosition`) — retry with the same
   * `idempotencyKey` so the gateway dedupes instead of double-submitting.
   */
  async waitForRequest(
    requestId: string,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<{ status: string; tx_hash: string | null; error_message: string | null }> {
    const timeout = opts.timeoutMs ?? 120_000;
    const interval = opts.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + timeout;
    let lastStatus = "";

    while (Date.now() < deadline) {
      const s = await this.getRequestStatus(requestId);
      if (s.status === "FINALIZED" || s.status === "FAILED") {
        return { status: s.status, tx_hash: s.tx_hash, error_message: s.error_message };
      }
      lastStatus = s.status;
      await sleep(interval);
    }

    if (lastStatus === "PENDING_UNKNOWN") {
      throw new Error(
        `Request ${requestId} is PENDING_UNKNOWN after ${timeout}ms: the relayed tx may still land. ` +
          `Do not resubmit non-idempotent actions without the same idempotencyKey.`,
      );
    }
    throw new Error(`Request ${requestId} did not finalize within ${timeout}ms`);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

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
  ): Promise<T> {
    const headerNonce = crypto.randomUUID();
    const deadlineSec = Math.floor(Date.now() / 1000) + 300;
    const bodyStr = JSON.stringify(body);

    const signature = await this.signRequest("POST", path, citizenId, headerNonce, deadlineSec, bodyStr);

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
    });

    const json = await res.json().catch(() => ({ ok: false, message: res.statusText })) as {
      ok?: boolean;
      data?: T;
      error_code?: string;
      message?: string;
    };

    if (!res.ok || json.ok === false) {
      throw new GatewayError(res.status, path, json.error_code ?? "UNKNOWN", json.message ?? "Unknown error");
    }

    if (json.data === undefined) {
      throw new GatewayError(res.status, path, "MISSING_DATA", "Gateway response missing data envelope");
    }

    return json.data;
  }

  private async get<T>(path: string, citizenId = "pending"): Promise<T> {
    const nonce = crypto.randomUUID();
    const deadlineSec = Math.floor(Date.now() / 1000) + 300;
    const bodyStr = "";

    const signature = await this.signRequest("GET", path, citizenId, nonce, deadlineSec, bodyStr);

    const res = await fetch(`${this.base}${path}`, {
      headers: {
        "x-agent-address": this.wallet.address,
        "x-agent-citizen-id": citizenId,
        "x-agent-nonce": nonce,
        "x-agent-deadline": String(deadlineSec),
        "x-agent-signature": signature,
      },
    });

    const json = await res.json().catch(() => ({ ok: false, message: res.statusText })) as {
      ok?: boolean;
      data?: T;
      error_code?: string;
      message?: string;
    };

    if (!res.ok || json.ok === false) {
      throw new GatewayError(res.status, path, json.error_code ?? "UNKNOWN", json.message ?? "Unknown error");
    }

    return (json.data ?? json) as T;
  }
}

export class GatewayError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly path: string,
    public readonly errorCode: string,
    public readonly detail: string,
  ) {
    super(`Gateway ${statusCode} [${errorCode}] at ${path}: ${detail}`);
    this.name = "GatewayError";
  }
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
