/**
 * Read API client — typed, fetch-based read surface for the public Read API.
 * All methods are read-only; they never mutate chain state.
 *
 * Base paths are rooted at `/api/v1/public/...` per read-api routing.
 * Response field names match the protocol / on-chain layer (`topic_id`, `topic_type`, `market_mode`, …).
 */

import type {
  ApiEnvelope,
  PositionSummary,
  CitizenSummary,
  MatchBoardBundle,
  MatchBoardStepRow,
  MatchSummary,
  GameSummary,
} from "./types.js";

export interface ReadClientOptions {
  baseUrl: string;
  /** Optional API key if the deployment requires it (future-proofing) */
  apiKey?: string;
}

export class ReadClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(opts: ReadClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.headers = opts.apiKey
      ? { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` }
      : { "Content-Type": "application/json" };
  }

  /** `/api/v1/public` + suffix (suffix must start with `/`). */
  private pub(suffix: string): string {
    const s = suffix.startsWith("/") ? suffix : `/${suffix}`;
    return `${this.base}/api/v1/public${s}`;
  }

  // ── System ────────────────────────────────────────────────────────────────

  async getSystemStatus(): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub("/system/status"));
  }

  async getSystemConfig(): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub("/system/config"));
  }

  async getSystemDeployment(): Promise<{
    chain_id: number;
    network: string;
    rpc_url: string;
    contracts: Record<string, string>;
  }> {
    return this.get(this.pub("/system/deployment"));
  }

  // ── Citizens ──────────────────────────────────────────────────────────────

  async getCitizen(citizenId: string): Promise<CitizenSummary> {
    return this.get<CitizenSummary>(this.pub(`/citizens/${citizenId}`));
  }

  async listCitizens(params?: { page?: number; page_size?: number; q?: string; citizen_id?: string; status?: number | string }): Promise<CitizenSummary[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<CitizenSummary[]>(this.pub(`/citizens${qs}`));
    return res.data;
  }

  async lookupCitizen(params: { citizen_id: string } | { display_name: string } | { wallet_address: string }): Promise<CitizenSummary> {
    const qs =
      "citizen_id" in params
        ? `?citizen_id=${encodeURIComponent(params.citizen_id)}`
        : "wallet_address" in params
          ? `?wallet_address=${encodeURIComponent(params.wallet_address)}`
          : `?display_name=${encodeURIComponent(params.display_name)}`;
    return this.get<CitizenSummary>(this.pub(`/citizens/lookup${qs}`));
  }

  async lookupCitizenByWallet(walletAddress: string): Promise<CitizenSummary | null> {
    try {
      return await this.lookupCitizen({ wallet_address: walletAddress });
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) return null;
      throw err;
    }
  }

  async getCitizenAudit(citizenId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/citizens/${citizenId}/audit`));
  }

  async listCitizenActivity(citizenId: string, params?: { page?: number; page_size?: number }): Promise<unknown[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<unknown[]>(this.pub(`/citizens/${citizenId}/activity${qs}`));
    return res.data;
  }

  async listCitizenLocks(citizenId: string): Promise<unknown[]> {
    const res = await this.getEnvelope<unknown[]>(this.pub(`/citizens/${citizenId}/locks`));
    return res.data;
  }

  async listCitizenPayouts(citizenId: string, params?: { page?: number; page_size?: number }): Promise<unknown[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<unknown[]>(this.pub(`/citizens/${citizenId}/payouts${qs}`));
    return res.data;
  }

  async listCitizenMatches(citizenId: string): Promise<MatchSummary[]> {
    const res = await this.getEnvelope<MatchSummary[]>(this.pub(`/citizens/${citizenId}/matches`));
    return res.data;
  }

  async listCitizenPositions(citizenId: string, params?: { page?: number; page_size?: number }): Promise<PositionSummary[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<PositionSummary[]>(this.pub(`/citizens/${citizenId}/positions${qs}`));
    return res.data;
  }

  async listCitizenGamesSettled(citizenId: string, params?: { page?: number; page_size?: number }): Promise<GameSummary[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<GameSummary[]>(this.pub(`/citizens/${citizenId}/games-settled${qs}`));
    return res.data;
  }

  async listCitizenJuryCases(citizenId: string, params?: { page?: number; page_size?: number }): Promise<unknown[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<unknown[]>(this.pub(`/citizens/${citizenId}/jury${qs}`));
    return res.data;
  }

  // ── Games (Read API `/topics/*` — field names match protocol) ────────────

  /**
   * List games with optional filters.
   *
   * Filter params use protocol field names:
   * - `topic_type` — `0` debate_text, `1` board_duel
   * - `state`      — numeric ordinal or enum label string (e.g. `"WAITLIST"`, `"ACTIVATED"`);
   *                  responses always serialize `state` as a label string
   */
  async listGames(params?: {
    page?: number;
    page_size?: number;
    state?: number | string;
    topic_type?: number;
    q?: string;
  }): Promise<GameSummary[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<GameSummary[]>(this.pub(`/topics${qs}`));
    return res.data;
  }

  /**
   * Get a single game by its on-chain ID (`topic_id`).
   * The returned object may include `settlers` and `waitlist` arrays.
   */
  async getGame(topicId: string): Promise<GameSummary & { settlers?: unknown[]; waitlist?: unknown[] }> {
    return this.get<GameSummary & { settlers?: unknown[]; waitlist?: unknown[] }>(this.pub(`/topics/${topicId}`));
  }

  async getGameWaitlist(topicId: string): Promise<unknown[]> {
    const res = await this.getEnvelope<unknown[]>(this.pub(`/topics/${topicId}/waitlist`));
    return res.data;
  }

  async getGameAudit(topicId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/topics/${topicId}/audit`));
  }

  async getGameCreationFeePreview(citizenId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/topics/creation-fee-preview/${citizenId}`));
  }

  // ── Matches ───────────────────────────────────────────────────────────────

  async listMatches(params?: {
    topic_id?: string;
    match_id?: string;
    state?: number | string;
    page?: number;
    page_size?: number;
    created_after?: string;
    created_before?: string;
    sort?: "created_at_desc" | "created_at_asc";
    q?: string;
  }): Promise<MatchSummary[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<MatchSummary[]>(this.pub(`/games${qs}`));
    return res.data;
  }

  async getMatch(matchId: string): Promise<MatchSummary> {
    return this.get<MatchSummary>(this.pub(`/games/${matchId}`));
  }

  /**
   * Board arena: latest step, wire-format `board_state`, and submit gating.
   *
   * Use `expected_mover_side`, `can_submit_turn`, and `block_reason` before calling
   * {@link GatewayClient.submitTurn} on board matches.
   */
  async getMatchBoard(matchId: string): Promise<MatchBoardBundle> {
    return this.get<MatchBoardBundle>(this.pub(`/games/${matchId}/board`));
  }

  /** All board steps for a match, with challenge + jury hooks per step. */
  async listMatchBoardSteps(matchId: string): Promise<MatchBoardStepRow[]> {
    const res = await this.getEnvelope<MatchBoardStepRow[]>(this.pub(`/games/${matchId}/board/steps`));
    return res.data;
  }

  async getMatchTimeline(matchId: string, params?: { page?: number; page_size?: number }): Promise<unknown[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<unknown[]>(this.pub(`/games/${matchId}/timeline${qs}`));
    return res.data;
  }

  async listMatchCompetitors(matchId: string): Promise<unknown[]> {
    const res = await this.getEnvelope<unknown[]>(this.pub(`/games/${matchId}/competitors`));
    return res.data;
  }

  async getMatchReplay(matchId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/games/${matchId}/replay`));
  }

  async getMatchAudit(matchId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/games/${matchId}/audit`));
  }

  async getMatchSettlementBreakdown(matchId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/games/${matchId}/settlement-breakdown`));
  }

  async listMatchSyntheticPositions(matchId: string): Promise<unknown[]> {
    const res = await this.getEnvelope<unknown[]>(this.pub(`/games/${matchId}/synthetic-positions`));
    return res.data;
  }

  /** List all positions opened on a match. */
  async listMatchPositions(matchId: string, params?: { page?: number; page_size?: number }): Promise<PositionSummary[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<PositionSummary[]>(this.pub(`/games/${matchId}/positions${qs}`));
    return res.data;
  }

  async getMatchPositionBoard(matchId: string): Promise<Record<string, unknown> | null> {
    return this.get<Record<string, unknown> | null>(this.pub(`/games/${matchId}/position-board`));
  }

  // ── Settlement (public views; settlement `challenges` table is not exposed) ─

  async getMatchSettlement(matchId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/games/${matchId}/settlement`));
  }

  async getMatchSettlementBuckets(matchId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/games/${matchId}/settlement/buckets`));
  }

  // ── Jury cases ─────────────────────────────────────────────────────────────

  async listJuryCases(params?: { page?: number; page_size?: number; match_id?: string; state?: number | string }): Promise<unknown[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<unknown[]>(this.pub(`/jury-cases${qs}`));
    return res.data;
  }

  async getJuryCase(juryCaseId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/jury-cases/${juryCaseId}`));
  }

  async listJuryAssignments(juryCaseId: string): Promise<unknown[]> {
    const res = await this.getEnvelope<unknown[]>(this.pub(`/jury-cases/${juryCaseId}/assignments`));
    return res.data;
  }

  async listJuryVotes(juryCaseId: string): Promise<unknown[]> {
    const res = await this.getEnvelope<unknown[]>(this.pub(`/jury-cases/${juryCaseId}/votes`));
    return res.data;
  }

  async getJuryRubrics(juryCaseId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/jury-cases/${juryCaseId}/rubrics`));
  }

  // ── Reputation ────────────────────────────────────────────────────────────

  async getReputationLeaderboard(params?: { page?: number; page_size?: number }): Promise<unknown[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<unknown[]>(this.pub(`/reputation/leaderboard${qs}`));
    return res.data;
  }

  async getCitizenReputation(citizenId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/reputation/${citizenId}`));
  }

  // ── Timelines ─────────────────────────────────────────────────────────────

  async getTimelineForMatch(matchId: string, params?: { page?: number; page_size?: number }): Promise<unknown[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<unknown[]>(this.pub(`/games/${matchId}/timeline${qs}`));
    return res.data;
  }

  async getTimelineForCitizen(citizenId: string, params?: { page?: number; page_size?: number }): Promise<unknown[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<unknown[]>(this.pub(`/timelines/citizen/${citizenId}${qs}`));
    return res.data;
  }

  async getTimelineForGame(topicId: string, params?: { page?: number; page_size?: number }): Promise<unknown[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<unknown[]>(this.pub(`/timelines/topic/${topicId}${qs}`));
    return res.data;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async get<T>(url: string): Promise<T> {
    const envelope = await this.getEnvelope<T>(url);
    return envelope.data;
  }

  private async getEnvelope<T>(url: string): Promise<ApiEnvelope<T>> {
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ApiError(res.status, url, body);
    }
    return res.json() as Promise<ApiEnvelope<T>>;
  }
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(`Read API ${statusCode} at ${path}: ${body}`);
    this.name = "ApiError";
  }
}

function toQs(params?: Record<string, unknown>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
}
