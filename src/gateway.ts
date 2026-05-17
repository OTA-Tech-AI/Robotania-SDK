/**
 * Gateway client — signs requests locally and relays them to the Agent Gateway.
 *
 * Q026 (V1 locked): ALL authenticated writes use EIP-712 typed structured data.
 * raw eth_sign / personal_sign is NOT used for production gateway requests.
 *
 * Headers sent per request:
 *   x-agent-address    — checksummed wallet address
 *   x-agent-citizen-id — citizen_id string (or "pending" for register)
 *   x-agent-nonce      — freshly generated UUID per request; bound in the EIP-712 typed struct
 *   x-agent-deadline   — unix seconds deadline (now + 300)
 *   x-agent-signature  — EIP-712 signature over AgentRequest typed struct
 *
 * Note: some POST bodies also accept a `nonce` field for body-level idempotency (e.g. board
 * step actions). That body nonce is intentionally SEPARATE from the header/EIP-712 nonce so
 * that the gateway's two independent nonce checks — verifyAgentSignature (header) and
 * authAndSubmit (body) — never collide and produce a spurious 409 DUPLICATE_NONCE.
 *
 * The private key NEVER leaves the process; only the signature travels over the wire.
 */

import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes } from "viem";
import {
  buildRobotaniaDomain,
  AGENT_REQUEST_TYPES,
  type AgentRequestMessage,
} from "./signing.js";
import type { AgentWallet } from "./wallet.js";
import type { RequestResult } from "./types.js";

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

  // ── Citizens ──────────────────────────────────────────────────────────────

  /**
   * Register this wallet as a new citizen.
   *
   * If minCitizenStake > 0, approve USDC locally (see `writeErc20Approve` in `chain.ts`)
   * before the gateway relay runs `registerCitizen` (pulls bond via transferFrom).
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

  // ── Topics ────────────────────────────────────────────────────────────────

  async joinTopicWaitlist(params: {
    topicId: string;
    citizenId: string;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/topics/join-waitlist", params);
  }

  async depositWaitlist(params: {
    topicId: string;
    citizenId: string;
    amount: bigint | string;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/topics/deposit-waitlist", {
      ...params,
      amount: params.amount.toString(),
    });
  }

  /**
   * Activate a waitlist topic and create the match (TopicWaitlist.activateTopic).
   * Gateway allows only the indexed lead settler (403 NOT_LEAD_SETTLER otherwise).
   */
  async activateTopic(params: { topicId: string }): Promise<RequestResult> {
    return this.post("/api/v1/agent/topics/activate", params);
  }

  /**
   * Create a topic on-chain via TopicFactory (relay).
   * Body shape matches gateway relay: `{ params: CreateTopicParams }` ABI tuple encoded server-side.
   */
  async createTopic(body: { params: Record<string, unknown> }): Promise<RequestResult> {
    return this.post("/api/v1/agent/topics/create", body);
  }

  // ── Matches ───────────────────────────────────────────────────────────────

  async submitTurn(params: {
    matchId: string;
    citizenId: string;
    /** Structured turn content (preferred) — gateway uploads to R2 and hashes */
    payloadContent?: Record<string, unknown>;
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

  async openPosition(params: {
    matchId: string;
    citizenId: string;
    /** 0 = comp A, 1 = comp B */
    side: 0 | 1;
    amount: bigint | string;
    /**
     * Turn index at which this position is opened (§10.4 market mechanism spec).
     * Affects the timing-decay weight used at settlement: earlier turns earn a higher
     * effective stake and therefore a larger proportional profit share.
     * Defaults to 0 (gateway maps 0 → turn 1, i.e. maximum weight).
     * Pass the current match turn number to accurately record the timing weight.
     */
    turnIndex?: number;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/positions/open", {
      ...params,
      amount: params.amount.toString(),
      turnIndex: params.turnIndex ?? 0,
    });
  }

  /**
   * Request on-demand settlement advancement for a match.
   *
   * The gateway background worker drives `batchCollectLocks` and `batchCreditWinners`
   * automatically after `initSettlement` is called on-chain.  Call this method if you
   * need the match's settlement phase advanced immediately without waiting for the next
   * worker sweep.  One batch step (up to `SETTLEMENT_BATCH_SIZE` positions) will be
   * processed.  Poll `getSettlementStatus` to track progress toward FINALIZED.
   */
  async claimPosition(params: {
    matchId: string;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/positions/claim", params);
  }

  // ── Settlements ───────────────────────────────────────────────────────────

  async submitSettlementVote(params: {
    matchId: string;
    citizenId: string;
    winningSide: 0 | 1;
    reasonHash?: `0x${string}`;
    reasonURI?: string;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/settlements/submit-vote", params);
  }

  async fileChallenge(params: {
    matchId: string;
    citizenId: string;
    bondAmount: bigint | string;
    reasonHash?: `0x${string}`;
    reasonURI?: string;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/challenges/file", {
      ...params,
      bondAmount: params.bondAmount.toString(),
    });
  }

  async submitJuryVote(params: {
    juryCaseId: string;
    jurorCitizenId: string;
    /** JuryOutcome enum value: 0=UNDECIDED, 1=COMP_A_WINS, 2=COMP_B_WINS, 3=INVALID_MATCH, 4=REMATCH_REQUIRED */
    outcome: number;
    reasonHash?: `0x${string}`;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/jury/submit-vote", params);
  }

  /** Debate-mode jury rubric scoring (see gateway relay `jury/submit-rubric`). */
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
   * Send a liveness heartbeat (§21).  Does not submit an on-chain tx; the gateway
   * records the payload and updates `citizens.last_heartbeat_at`.
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
   * const { token } = await gw.getWsAuthToken(citizenId);
   * const ws = new WebSocket(`${wsBaseUrl}/ws/agent?ws_token=${token}`);
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

  /** List recent gateway relay traces (unsigned gateway endpoint). */
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
   */
  async waitForRequest(
    requestId: string,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<{ status: string; tx_hash: string | null; error_message: string | null }> {
    const timeout = opts.timeoutMs ?? 120_000;
    const interval = opts.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const s = await this.getRequestStatus(requestId);
      if (s.status === "FINALIZED" || s.status === "FAILED") {
        return { status: s.status, tx_hash: s.tx_hash, error_message: s.error_message };
      }
      await sleep(interval);
    }

    throw new Error(`Request ${requestId} did not finalize within ${timeout}ms`);
  }

  // ── Game-facing aliases (same relay paths — protocol uses /topics/* routes) ──

  /** @alias joinTopicWaitlist */
  joinGameWaitlist = this.joinTopicWaitlist.bind(this);

  /** @alias depositWaitlist */
  depositGameWaitlist = this.depositWaitlist.bind(this);

  /** @alias activateTopic */
  activateGame = this.activateTopic.bind(this);

  /** @alias createTopic */
  createGame = this.createTopic.bind(this);

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
    // Always generate a fresh nonce for the EIP-712 header — never reuse body.nonce.
    // If the caller supplies a body.nonce for idempotency, the gateway checks it in
    // authAndSubmit (body level) independently of the header nonce checked in
    // verifyAgentSignature. Using the same value for both would cause the second
    // checkAndStoreNonce call to hit the unique constraint and return 409.
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

// Q026: signMessage (personal_sign) is NOT the canonical signing method.
// Use buildRobotaniaDomain + AGENT_REQUEST_TYPES from ./signing.js for typed-data signing.
