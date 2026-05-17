/**
 * Read API client — typed, fetch-based read surface for the public Read API.
 * All methods are read-only; they never mutate chain state.
 *
 * Base paths are rooted at `/api/v1/public/...` per read-api routing.
 */

import type {
  ApiEnvelope,
  PositionSummary,
  CitizenSummary,
  MatchBoardBundle,
  MatchBoardStepRow,
  MatchSummary,
  TopicSummary,
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

  async listCitizenGamesSettled(citizenId: string, params?: { page?: number; page_size?: number }): Promise<TopicSummary[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<TopicSummary[]>(this.pub(`/citizens/${citizenId}/games-settled${qs}`));
    return res.data;
  }

  async listCitizenJuryCases(citizenId: string, params?: { page?: number; page_size?: number }): Promise<unknown[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<unknown[]>(this.pub(`/citizens/${citizenId}/jury${qs}`));
    return res.data;
  }

  // ── Topics ────────────────────────────────────────────────────────────────

  async listTopics(params?: { page?: number; page_size?: number; state?: number | string; topic_type?: number; q?: string }): Promise<TopicSummary[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<TopicSummary[]>(this.pub(`/topics${qs}`));
    return res.data;
  }

  async getTopic(topicId: string): Promise<TopicSummary & { settlers?: unknown[]; waitlist?: unknown[] }> {
    return this.get(this.pub(`/topics/${topicId}`));
  }

  async getTopicWaitlist(topicId: string): Promise<unknown[]> {
    const res = await this.getEnvelope<unknown[]>(this.pub(`/topics/${topicId}/waitlist`));
    return res.data;
  }

  async getTopicAudit(topicId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/topics/${topicId}/audit`));
  }

  async getTopicCreationFeePreview(citizenId: string): Promise<Record<string, unknown>> {
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
    const res = await this.getEnvelope<MatchSummary[]>(this.pub(`/matches${qs}`));
    return res.data;
  }

  async getMatch(matchId: string): Promise<MatchSummary> {
    return this.get<MatchSummary>(this.pub(`/matches/${matchId}`));
  }

  /** Board arena: latest step + wire-format board_state (Read API). */
  async getMatchBoard(matchId: string): Promise<MatchBoardBundle> {
    return this.get<MatchBoardBundle>(this.pub(`/matches/${matchId}/board`));
  }

  /** All board steps for a match, with challenge + jury hooks per step. */
  async listMatchBoardSteps(matchId: string): Promise<MatchBoardStepRow[]> {
    const res = await this.getEnvelope<MatchBoardStepRow[]>(this.pub(`/matches/${matchId}/board/steps`));
    return res.data;
  }

  async getMatchTimeline(matchId: string, params?: { page?: number; page_size?: number }): Promise<unknown[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<unknown[]>(this.pub(`/matches/${matchId}/timeline${qs}`));
    return res.data;
  }

  async listMatchCompetitors(matchId: string): Promise<unknown[]> {
    const res = await this.getEnvelope<unknown[]>(this.pub(`/matches/${matchId}/competitors`));
    return res.data;
  }

  async getMatchReplay(matchId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/matches/${matchId}/replay`));
  }

  async getMatchAudit(matchId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/matches/${matchId}/audit`));
  }

  async getMatchSettlementBreakdown(matchId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/matches/${matchId}/settlement-breakdown`));
  }

  async listMatchSyntheticPositions(matchId: string): Promise<unknown[]> {
    const res = await this.getEnvelope<unknown[]>(this.pub(`/matches/${matchId}/synthetic-positions`));
    return res.data;
  }

  /** List all positions opened on a match. */
  async listMatchPositions(matchId: string, params?: { page?: number; page_size?: number }): Promise<PositionSummary[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<PositionSummary[]>(this.pub(`/matches/${matchId}/positions${qs}`));
    return res.data;
  }

  async getMatchPositionBoard(matchId: string): Promise<Record<string, unknown> | null> {
    return this.get<Record<string, unknown> | null>(this.pub(`/matches/${matchId}/position-board`));
  }

  // ── Settlement / challenges ───────────────────────────────────────────────

  async listChallenges(params?: { page?: number; page_size?: number; match_id?: string; state?: number | string }): Promise<unknown[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<unknown[]>(this.pub(`/challenges${qs}`));
    return res.data;
  }

  async getMatchSettlement(matchId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/matches/${matchId}/settlement`));
  }

  async getMatchSettlementBuckets(matchId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/matches/${matchId}/settlement/buckets`));
  }

  async listMatchChallenges(matchId: string): Promise<unknown[]> {
    const res = await this.getEnvelope<unknown[]>(this.pub(`/matches/${matchId}/challenges`));
    return res.data;
  }

  async getChallenge(challengeId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(this.pub(`/challenges/${challengeId}`));
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
    const res = await this.getEnvelope<unknown[]>(this.pub(`/timelines/match/${matchId}${qs}`));
    return res.data;
  }

  async getTimelineForCitizen(citizenId: string, params?: { page?: number; page_size?: number }): Promise<unknown[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<unknown[]>(this.pub(`/timelines/citizen/${citizenId}${qs}`));
    return res.data;
  }

  async getTimelineForTopic(topicId: string, params?: { page?: number; page_size?: number }): Promise<unknown[]> {
    const qs = toQs(params as Record<string, unknown>);
    const res = await this.getEnvelope<unknown[]>(this.pub(`/timelines/topic/${topicId}${qs}`));
    return res.data;
  }

  // ── Game-facing aliases (same REST paths as topics — protocol uses topic_id) ──

  /** @alias listTopics */
  listGames = this.listTopics.bind(this);

  /** @alias getTopic */
  getGame = this.getTopic.bind(this);

  /** @alias getTopicWaitlist */
  getGameWaitlist = this.getTopicWaitlist.bind(this);

  /** @alias getTopicAudit */
  getGameAudit = this.getTopicAudit.bind(this);

  /** @alias getTopicCreationFeePreview */
  getGameCreationFeePreview = this.getTopicCreationFeePreview.bind(this);

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
