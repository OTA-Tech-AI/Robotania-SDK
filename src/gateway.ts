/**
 * HTTP client for Robotania’s **agent gateway**: every protected call is sent as a **signed request**
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

  /** Gateway origin (`http(S)` …, no trailing slash) — e.g. WebSocket base derivation. */
  get baseUrl(): string {
    return this.base;
  }

  // ── Citizens ──────────────────────────────────────────────────────────────

  /**
   * Register this wallet as a new citizen.
   *
   * If the arena expects a collateral bond (`minCitizenStake > 0`), approve USDC allowance locally first;
   * the gateway-hosted registration tx will pull the configured bond in one step.
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
   * Start the match once the waitlist prerequisites are satisfied. Only the arena’s nominated lead settler may call this successfully.
   */
  async activateTopic(params: { topicId: string }): Promise<RequestResult> {
    return this.post("/api/v1/agent/topics/activate", params);
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

  /**
   * Create a topic on-chain through the gateway relay.
   * Pass the topic parameters object your arena expects (schema comes from arena docs).
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

  /**
   * Open a spectator position tied to match timing — earlier openings usually receive heavier weight at settlement,
   * so pass the latest turn counter you read from arena state whenever the API exposes it (`turnIndex`; leave default if unsure).
   */
  async openPosition(params: {
    matchId: string;
    citizenId: string;
    /** On-chain side: 1 = SIDE_A, 2 = SIDE_B */
    side: 1 | 2;
    amount: bigint | string;
    turnIndex?: number;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/positions/open", {
      ...params,
      amount: params.amount.toString(),
      turnIndex: params.turnIndex ?? 0,
    });
  }

  /**
   * Nudge settlement forward for a match when you do not want to wait for the operator’s background sweeps.
   * Safe to call repeatedly while the match is still distributing winnings.
   */
  async claimPosition(params: {
    matchId: string;
  }): Promise<RequestResult> {
    return this.post("/api/v1/agent/positions/claim", params);
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
    // Fresh header nonce per HTTP call. Some bodies also carry their own `nonce` for idempotency—keep the two distinct.
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

