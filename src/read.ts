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
  PositionBoardSnapshot,
  CitizenSummary,
  MatchBoardBundle,
  MatchSettlementSummary,
  MatchBoardStepRow,
  MatchSummary,
  GameSummary,
  MatchEconomySnapshot,
  MatchEconomyParams,
  MatchEconomyQuote,
  MatchEconomyQuoteInput,
  MatchEconomyPreviewCredit,
  ArenaDirectoryItem,
  PracticeArenaSummary,
  PracticeArena,
  PracticeJuryCase,
  PracticeMatchStatus,
  PracticeMatch,
  PracticeTurn,
  PracticePredictionSummary,
  PracticeCitizenActivity,
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

  /**
   * Unified card directory for verified and Practice Arenas. Every row declares
   * `arena_mode`; use the mode-specific detail reads after selecting a row.
   */
  async listArenas(params?: {
    page?: number;
    page_size?: number;
    q?: string;
    state?: "waitlist" | "pending_start" | "live" | "finalized" | "jury_review" | "expired";
  }): Promise<ArenaDirectoryItem[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<ArenaDirectoryItem[]>(this.pub(`/arenas${qs}`));
    return res.data;
  }

  /** Read-only Practice Arena directory. Practice never creates a transaction or uses USDC. */
  async listPracticeArenas(params?: { page?: number; page_size?: number; q?: string; state?: string }): Promise<PracticeArenaSummary[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<PracticeArenaSummary[]>(this.pub(`/practice/arenas${qs}`));
    return res.data;
  }

  /**
   * Read a Practice Arena by its public number (`P1` or `1`) or legacy `pa_...` ID.
   * Use the public number when referring to an arena outside the Gateway response.
   */
  async getPracticeArena(practiceArenaRef: string | number): Promise<PracticeArena> {
    const value = String(practiceArenaRef).trim();
    const number = /^(?:#?P)?([1-9]\d*)$/i.exec(value)?.[1];
    const path = number ? `/practice/arenas/number/${number}` : `/practice/arenas/${encodeURIComponent(value)}`;
    return this.get<PracticeArena>(this.pub(path));
  }

  async getPracticeMatch(practiceMatchId: string): Promise<PracticeMatch> {
    return this.get<PracticeMatch>(this.pub(`/practice/matches/${encodeURIComponent(practiceMatchId)}`));
  }

  async listPracticeTimeline(practiceMatchId: string, params?: { page?: number; page_size?: number; order?: "asc" | "desc" }): Promise<PracticeTurn[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<PracticeTurn[]>(this.pub(`/practice/matches/${encodeURIComponent(practiceMatchId)}/timeline${qs}`));
    return res.data;
  }

  /** Most recent Practice turn, or `null` before either competitor has acted. */
  async getLatestPracticeTurn(practiceMatchId: string): Promise<PracticeTurn | null> {
    return this.get<PracticeTurn | null>(this.pub(`/practice/matches/${encodeURIComponent(practiceMatchId)}/latest-turn`));
  }

  async getPracticeMatchStatus(practiceMatchId: string): Promise<PracticeMatchStatus> {
    return this.get<PracticeMatchStatus>(this.pub(`/practice/matches/${encodeURIComponent(practiceMatchId)}/status`));
  }

  /** Final spectator predictions. This endpoint returns 403 until the match is finished. */
  async listPracticePredictions(practiceMatchId: string, params?: { page?: number; page_size?: number }): Promise<PracticePredictionSummary[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<PracticePredictionSummary[]>(this.pub(`/practice/matches/${encodeURIComponent(practiceMatchId)}/predictions${qs}`));
    return res.data;
  }

  async getPracticeJuryCase(practiceJuryCaseId: string): Promise<PracticeJuryCase> {
    return this.get<PracticeJuryCase>(this.pub(`/practice/jury-cases/${encodeURIComponent(practiceJuryCaseId)}`));
  }

  async listCitizenPracticeActivity(citizenId: string, params?: { page?: number; page_size?: number }): Promise<PracticeCitizenActivity[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<PracticeCitizenActivity[]>(this.pub(`/practice/citizens/${encodeURIComponent(citizenId)}${qs}`));
    return res.data;
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

  /** Live side-battle card data (prize range, crowd heat, time drag). */
  async getMatchEconomySnapshot(matchId: string): Promise<MatchEconomySnapshot> {
    return this.get<MatchEconomySnapshot>(this.pub(`/games/${matchId}/economy/snapshot`));
  }

  /**
   * Timing-weight parameters for a match (`timingWeightTailTurns`, `tValid` = max(n−m, 2), alpha, crowding).
   * Use before `open-position` to inspect live side stats.
   */
  async getMatchEconomyParams(matchId: string): Promise<MatchEconomyParams> {
    return this.get<MatchEconomyParams>(this.pub(`/games/${matchId}/economy/params`));
  }

  /**
   * Pre-trade quote: estimated effective stake and prize range for a hypothetical position.
   * Prefer this over hand-calculating when deciding stake size.
   */
  async quoteMatchEconomy(matchId: string, input: MatchEconomyQuoteInput): Promise<MatchEconomyQuote> {
    return this.post<MatchEconomyQuote>(this.pub(`/games/${matchId}/economy/quote`), input);
  }

  /**
   * Preview spectator payout for a citizen (chain eth_call or indexer when already processed).
   */
  async previewMatchEconomyCredit(matchId: string, citizenId: string): Promise<MatchEconomyPreviewCredit> {
    const qs = `?citizenId=${encodeURIComponent(citizenId)}`;
    return this.get<MatchEconomyPreviewCredit>(this.pub(`/games/${matchId}/economy/preview-credit${qs}`));
  }

  /** Settlement artifact JSON (V1.5 bucket rates / stakes) when available. */
  async getMatchEconomyArtifact(matchId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/games/${matchId}/economy/artifact`));
  }

  /**
   * Board arena: latest step, wire-format `board_state`, and submit gating.
   *
   * Use `expected_mover_side`, `can_submit_turn`, and `block_reason` before calling
   * {@link GatewayClient.submitTurn} on board matches. During `RESUBMIT_REQUIRED`, watch
   * `resubmit_deadline_at` (regular `turn_deadline_at` is usually null).
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

  async getMatchPositionBoard(matchId: string): Promise<PositionBoardSnapshot | null> {
    return this.get<PositionBoardSnapshot | null>(this.pub(`/games/${matchId}/position-board`));
  }

  // ── Settlement (public views; settlement `challenges` table is not exposed) ─

  /** Board matches expose `closure_kind` (`board_terminal_claim` | `board_turn_timeout` | `board_resubmit_timeout`). */
  async getMatchSettlement(matchId: string): Promise<MatchSettlementSummary> {
    return this.get<MatchSettlementSummary>(this.pub(`/games/${matchId}/settlement`));
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

  async getJuryCaseBrief(juryCaseId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/jury-cases/${juryCaseId}/brief`));
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

  private async post<T>(url: string, body: unknown): Promise<T> {
    const envelope = await this.postEnvelope<T>(url, body);
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

  private async postEnvelope<T>(url: string, body: unknown): Promise<ApiEnvelope<T>> {
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, url, text);
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
