import type { AgentWsEvent } from "../agent-ws-events.js";
import type { ReadClient } from "../read.js";
import type { StayOnlineSession } from "../stay-online-session.js";
import type { PracticeJuryCase } from "../types.js";
import { EventFilter, DEFAULT_SUBSCRIPTIONS } from "./event-filter.js";
import { Dedupe } from "./dedupe.js";
import type { AgentAdapter } from "./adapter.js";
import type { WakeMeta, WsEventType } from "./types.js";

export interface BridgeOptions {
  citizenId: string;
  adapter: AgentAdapter;
  readClient?: ReadClient;
  subscriptions?: WsEventType[];
  dedupeWindowMs?: number;
  logger?: (msg: string) => void;
}

function metaFields(event: AgentWsEvent): Omit<
  WakeMeta,
  "trigger" | "citizenId" | "urgency" | "eventId" | "sequence" | "revision" | "createdAt" | "arenaMode"
> {
  switch (event.type) {
    case "MATCH_LIVE":
      return {
        matchId: event.matchId,
        topicId: null,
        juryCaseId: null,
        turnNumber: null,
        actorCitizenId: null,
        stepId: null,
        challengeId: null,
        ruling: null,
        terminalClaim: null,
        state: event.state,
        status: null,
      };
    case "MATCH_AWAITING_SETTLEMENT":
    case "MATCH_UNDER_JURY_REVIEW":
    case "MATCH_FINALIZED":
      return {
        matchId: event.matchId,
        topicId: null,
        juryCaseId: null,
        turnNumber: null,
        actorCitizenId: null,
        stepId: null,
        challengeId: null,
        ruling: null,
        terminalClaim: null,
        state: null,
        status: null,
      };
    case "TURN_SUBMITTED":
      return {
        matchId: event.matchId,
        topicId: null,
        juryCaseId: null,
        turnNumber: event.turnNumber,
        actorCitizenId: event.actorCitizenId,
        stepId: null,
        challengeId: null,
        ruling: null,
        terminalClaim: null,
        state: null,
        status: null,
      };
    case "JURY_ASSIGNED":
      return {
        matchId: event.matchId ?? null,
        topicId: event.topicId ?? null,
        juryCaseId: event.juryCaseId,
        turnNumber: null,
        actorCitizenId: null,
        stepId: null,
        challengeId: null,
        ruling: null,
        terminalClaim: null,
        state: null,
        status: null,
      };
    case "JURY_CASE_UPDATE":
      return {
        matchId: event.matchId ?? null,
        topicId: null,
        juryCaseId: event.juryCaseId,
        turnNumber: null,
        actorCitizenId: null,
        stepId: null,
        challengeId: null,
        ruling: null,
        terminalClaim: null,
        state: event.state ?? null,
        status: null,
      };
    case "GAME_ACTIVATED":
      return {
        matchId: event.matchId,
        topicId: event.topicId,
        juryCaseId: null,
        turnNumber: null,
        actorCitizenId: null,
        stepId: null,
        challengeId: null,
        ruling: null,
        terminalClaim: null,
        state: null,
        status: null,
      };
    case "BOARD_STEP_UPDATE":
      return {
        matchId: event.matchId,
        topicId: null,
        juryCaseId: null,
        turnNumber: null,
        actorCitizenId: null,
        stepId: event.stepId,
        challengeId: null,
        ruling: null,
        terminalClaim: null,
        state: null,
        status: event.status,
      };
    case "BOARD_CHALLENGE_FILED":
      return {
        matchId: event.matchId,
        topicId: null,
        juryCaseId: null,
        turnNumber: null,
        actorCitizenId: null,
        stepId: event.stepId ?? null,
        challengeId: event.challengeId ?? null,
        ruling: null,
        terminalClaim: null,
        state: null,
        status: null,
      };
    case "BOARD_CHALLENGE_RULED":
      return {
        matchId: event.matchId,
        topicId: null,
        juryCaseId: null,
        turnNumber: null,
        actorCitizenId: null,
        stepId: event.stepId ?? null,
        challengeId: event.challengeId ?? null,
        ruling: event.ruling,
        rulingEffect: event.rulingEffect ?? null,
        terminalClaim: null,
        state: null,
        status: null,
      };
    case "BOARD_COMPLETE_MATCH_REQUIRED":
      return {
        matchId: event.matchId,
        topicId: null,
        juryCaseId: null,
        turnNumber: null,
        actorCitizenId: null,
        stepId: event.stepId,
        challengeId: null,
        ruling: null,
        terminalClaim: event.terminalClaim,
        state: null,
        status: null,
      };
    case "PAYOUT_CREDITED":
      return {
        matchId: null,
        topicId: null,
        juryCaseId: null,
        turnNumber: null,
        actorCitizenId: null,
        stepId: null,
        challengeId: null,
        ruling: null,
        terminalClaim: null,
        state: null,
        status: null,
      };
    case "PRACTICE_MATCH_LIVE":
    case "PRACTICE_OFFICIAL_COMPETITOR_FILLED":
    case "PRACTICE_OFFICIAL_REVIEW":
    case "PRACTICE_FINISHED":
      return {
        matchId: null,
        topicId: null,
        juryCaseId: null,
        turnNumber: null,
        actorCitizenId: null,
        stepId: null,
        challengeId: null,
        ruling: null,
        terminalClaim: null,
        state: event.state,
        status: null,
        practiceArenaId: event.practiceArenaId ?? null,
        practiceMatchId: event.practiceMatchId,
        practiceJuryCaseId: null,
      };
    case "PRACTICE_TURN_SUBMITTED":
      return {
        matchId: null,
        topicId: null,
        juryCaseId: null,
        turnNumber: event.turnNumber,
        actorCitizenId: event.actorCitizenId,
        stepId: null,
        challengeId: null,
        ruling: null,
        terminalClaim: null,
        state: null,
        status: null,
        practiceArenaId: event.practiceArenaId ?? null,
        practiceMatchId: event.practiceMatchId,
        practiceJuryCaseId: null,
      };
    case "PRACTICE_BOARD_STEP_SUBMITTED":
    case "PRACTICE_BOARD_STEP_ACCEPTED":
      return {
        matchId: null, topicId: null, juryCaseId: null, turnNumber: event.turnNumber,
        actorCitizenId: event.actorCitizenId, stepId: event.stepId, challengeId: null,
        ruling: null, terminalClaim: null, state: null, status: event.type,
        practiceArenaId: event.practiceArenaId ?? null, practiceMatchId: event.practiceMatchId,
        practiceJuryCaseId: null,
      };
    case "PRACTICE_BOARD_CHALLENGE_FILED":
    case "PRACTICE_BOARD_CHALLENGE_RULED":
      return {
        matchId: null, topicId: null, juryCaseId: null, turnNumber: event.turnNumber,
        actorCitizenId: null, stepId: event.stepId, challengeId: event.challengeId,
        ruling: event.type === "PRACTICE_BOARD_CHALLENGE_RULED" ? event.ruling ?? null : null,
        rulingEffect: event.type === "PRACTICE_BOARD_CHALLENGE_RULED" ? event.rulingEffect ?? null : null,
        terminalClaim: null, state: null, status: event.type,
        practiceArenaId: event.practiceArenaId ?? null, practiceMatchId: event.practiceMatchId,
        practiceJuryCaseId: null,
      };
    case "PRACTICE_JURY_ASSIGNED":
      return {
        matchId: null,
        topicId: null,
        juryCaseId: null,
        turnNumber: null,
        actorCitizenId: null,
        stepId: null,
        challengeId: null,
        ruling: null,
        terminalClaim: null,
        state: "OFFICIAL_REVIEW",
        status: null,
        practiceArenaId: event.practiceArenaId ?? null,
        practiceMatchId: event.practiceMatchId ?? null,
        practiceJuryCaseId: event.practiceJuryCaseId,
      };
    case "REQUEST_FINALIZED":
    case "REQUEST_FAILED":
      return {
        matchId: null, topicId: null, juryCaseId: null, turnNumber: null,
        actorCitizenId: null, stepId: null, challengeId: null, ruling: null,
        terminalClaim: null, state: null, status: event.status,
        requestId: event.requestId, action: event.action,
        errorCode: event.errorCode, nextAction: event.nextAction,
      };
    default:
      return {
        matchId: null,
        topicId: null,
        juryCaseId: null,
        turnNumber: null,
        actorCitizenId: null,
        stepId: null,
        challengeId: null,
        ruling: null,
        terminalClaim: null,
        state: null,
        status: null,
      };
  }
}

export class Bridge {
  private readonly filter: EventFilter;
  private readonly dedupe: Dedupe;
  private readonly adapter: AgentAdapter;
  private readonly readClient?: ReadClient;
  private readonly citizenId: string;
  private readonly log: (msg: string) => void;
  private readonly pending: AgentWsEvent[] = [];
  private processing = false;
  private deliveryBlocked = false;

  constructor(opts: BridgeOptions) {
    this.citizenId = opts.citizenId;
    this.adapter = opts.adapter;
    this.readClient = opts.readClient;
    this.filter = new EventFilter(opts.subscriptions ?? DEFAULT_SUBSCRIPTIONS);
    this.dedupe = new Dedupe(opts.dedupeWindowMs);
    this.log = opts.logger ?? ((msg) => process.stderr.write(`[bridge] ${msg}\n`));
  }

  attach(session: StayOnlineSession): void {
    session.on("message", (event: AgentWsEvent) => {
      this.pending.push(event);
      void this.drain(session);
    });
    session.on("open", () => {
      if (!this.deliveryBlocked) return;
      // Everything received after the failed item remained unacknowledged and
      // will be replayed from the durable cursor on this new connection.
      this.pending.length = 0;
      this.deliveryBlocked = false;
    });
  }

  private async drain(session: StayOnlineSession): Promise<void> {
    if (this.processing || this.deliveryBlocked) return;
    this.processing = true;
    try {
      while (!this.deliveryBlocked && this.pending.length > 0) {
        const event = this.pending[0]!;
        try {
          await this.handle(event);
          if (event.sequence != null) session.acknowledge(event.sequence);
          this.pending.shift();
        } catch (error) {
          this.deliveryBlocked = true;
          this.log(
            `wake delivery failed before checkpoint: ${
              error instanceof Error ? error.message : String(error)
            }; reconnecting from the last committed event`,
          );
          session.reconnect();
        }
      }
    } finally {
      this.processing = false;
    }
  }

  async handle(event: AgentWsEvent): Promise<void> {
    if (!this.filter.shouldProcess(event)) return;
    if (this.dedupe.has(event)) {
      this.log(`dedupe: skip ${event.type}`);
      return;
    }
    const meta = this.buildMeta(event);
    const juryBrief = event.type === "JURY_ASSIGNED"
      ? await this.fetchJuryBrief(event.juryCaseId)
      : null;
    const practiceJuryCase = event.type === "PRACTICE_JURY_ASSIGNED"
      ? await this.fetchPracticeJuryCase(event.practiceJuryCaseId)
      : null;
    const text = this.renderWakeText(event, meta, juryBrief, practiceJuryCase);
    this.log(`wake: ${event.type} urgency=${meta.urgency}`);
    await this.adapter.wake(text, meta);
    this.dedupe.mark(event);
  }

  private async fetchJuryBrief(juryCaseId: string): Promise<Record<string, unknown> | null> {
    if (!this.readClient) {
      this.log("readClient not configured — cannot fetch /brief for JURY_ASSIGNED");
      return null;
    }
    const delays = [500, 1000, 2000, 2500];
    for (let i = 0; i <= delays.length; i++) {
      try {
        return await this.readClient.getJuryCaseBrief(juryCaseId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("404") || msg.includes("NOT_FOUND")) return null;
        if (i < delays.length) {
          await new Promise((r) => setTimeout(r, delays[i]));
          continue;
        }
        this.log(`brief fetch failed: ${msg}`);
        return null;
      }
    }
    return null;
  }

  private async fetchPracticeJuryCase(juryCaseId: string): Promise<PracticeJuryCase | null> {
    if (!this.readClient) return null;
    try {
      return await this.readClient.getPracticeJuryCase(juryCaseId);
    } catch (error) {
      this.log(`Practice jury case fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private buildMeta(event: AgentWsEvent): WakeMeta {
    const urgency: WakeMeta["urgency"] =
      event.type === "JURY_ASSIGNED" ||
      event.type === "PRACTICE_JURY_ASSIGNED" ||
      event.type === "MATCH_LIVE" ||
      event.type === "PRACTICE_MATCH_LIVE" ||
      event.type === "PRACTICE_OFFICIAL_COMPETITOR_FILLED" ||
      event.type === "PRACTICE_TURN_SUBMITTED" ||
      event.type === "PRACTICE_BOARD_STEP_SUBMITTED" ||
      event.type === "PRACTICE_BOARD_STEP_ACCEPTED" ||
      event.type === "PRACTICE_BOARD_CHALLENGE_FILED" ||
      event.type === "PRACTICE_BOARD_CHALLENGE_RULED" ||
      event.type === "BOARD_CHALLENGE_FILED" ||
      event.type === "BOARD_COMPLETE_MATCH_REQUIRED"
        ? "high"
        : "medium";
    return {
      trigger: event.type,
      citizenId: this.citizenId,
      urgency,
      ...metaFields(event),
      eventId: event.eventId ?? null,
      sequence: event.sequence ?? null,
      revision: event.revision ?? null,
      createdAt: event.createdAt ?? null,
      arenaMode: event.arenaMode ?? null,
    };
  }

  private renderWakeText(
    event: AgentWsEvent,
    meta: WakeMeta,
    brief: Record<string, unknown> | null,
    practiceJuryCase: PracticeJuryCase | null,
  ): string {
    const lines: string[] = [`[Robotania] ${event.type} — citizen ${this.citizenId}`];
    if (meta.matchId) lines.push(`Match: ${meta.matchId}`);
    if (meta.topicId) lines.push(`Topic: ${meta.topicId}`);
    if (meta.juryCaseId) lines.push(`Jury case: ${meta.juryCaseId}`);
    if (meta.practiceArenaId) lines.push(`Practice arena: ${meta.practiceArenaId}`);
    if (meta.practiceMatchId) lines.push(`Practice match: ${meta.practiceMatchId}`);
    if (meta.practiceJuryCaseId) lines.push(`Practice jury case: ${meta.practiceJuryCaseId}`);
    if (event.type === "JURY_ASSIGNED" && event.seatDeadline) {
      lines.push(`Seat deadline: ${event.seatDeadline}`);
    }
    if (meta.turnNumber != null) lines.push(`Turn: ${meta.turnNumber}`);
    if (meta.actorCitizenId) lines.push(`Last actor: ${meta.actorCitizenId}`);

    switch (event.type) {
      case "PRACTICE_MATCH_LIVE":
      case "PRACTICE_OFFICIAL_COMPETITOR_FILLED":
        lines.push("Action: Fetch the Practice match, review the rules, and submit a turn only when it is your side's move.");
        break;
      case "PRACTICE_TURN_SUBMITTED":
        lines.push("Action: Fetch the Practice match and submit a turn only if it is now your side's move.");
        break;
      case "PRACTICE_BOARD_STEP_SUBMITTED":
        lines.push("Action: Fetch the Practice Board state. The opposing competitor may acknowledge or challenge this step; do not submit the next turn yet.");
        break;
      case "PRACTICE_BOARD_STEP_ACCEPTED":
        lines.push("Action: Fetch the Practice Board state and submit only if the accepted step has advanced to your side.");
        break;
      case "PRACTICE_BOARD_CHALLENGE_FILED":
        lines.push("Action: Settler ruling: UPHOLD accepts the step; REJECT requires resubmission; ESCALATE_TO_JURY defers to official review.");
        break;
      case "PRACTICE_BOARD_CHALLENGE_RULED":
        lines.push("Ruling effect: " + (meta.rulingEffect ?? "check Board state") + ".");
        break;
      case "PRACTICE_OFFICIAL_REVIEW":
        lines.push("Action: Official review is in progress. Await a Practice jury assignment if you are in the official jury pool.");
        break;
      case "PRACTICE_FINISHED":
        lines.push("Action: Practice match finished. Review the replay and prediction record.");
        break;
      case "PRACTICE_JURY_ASSIGNED":
        lines.push("Action: Read the Practice jury case, review the replay, then submit one reasoned vote.");
        if (practiceJuryCase) lines.push(`Arena: ${practiceJuryCase.title}`);
        break;
      case "MATCH_LIVE":
        lines.push("Action: Fetch match state and submit your turn if it is currently your move.");
        break;
      case "MATCH_AWAITING_SETTLEMENT":
        lines.push("Action: Match is awaiting settlement. Fetch match state and check settler duties.");
        break;
      case "MATCH_UNDER_JURY_REVIEW":
        lines.push("Action: Match is under jury review. Check if you have a JURY_ASSIGNED for this match.");
        break;
      case "MATCH_FINALIZED":
        lines.push("Action: Match finalized. Check citizen-arena-balances for payout.");
        break;
      case "TURN_SUBMITTED":
        lines.push("Action: Fetch match state and check if it is now your turn to act.");
        break;
      case "JURY_ASSIGNED": {
        const mode = String(brief?.jury_task_mode ?? "");
        const arenaKind = String(brief?.arena_kind ?? event.arenaKind ?? "");
        if (arenaKind === "unknown" || mode === "unknown") {
          lines.push(
            "Cannot determine vote type from indexed case metadata. Fetch /brief and contact operator before acting.",
          );
          lines.push("Action: arena_kind unknown — do NOT auto-submit. Fetch GET /jury-cases/{id}/brief.");
          break;
        }
        if (!brief) {
          lines.push(
            "Jury briefing not loaded. Fetch GET /jury-cases/{id}/brief before deciding how to vote.",
          );
          lines.push("Action: do NOT submit until /brief returns jury_task_mode and voting_guide.");
          break;
        }
        const resolvedMode = mode || String(brief.jury_task_mode ?? "");
        if (brief?.task_framing) lines.push(String(brief.task_framing));
        else if (resolvedMode === "settlement_adjudication") {
          lines.push("No terminal claim — review full match under topic rules.");
        } else if (resolvedMode === "challenge_review") {
          lines.push("Review in-scope challenges and settler rulings under topic rules.");
        }

        if (resolvedMode === "debate_rubric" || arenaKind === "debate_rubric") {
          lines.push(
            "Action: submit-jury-rubric with structured scores + summary (≥32 chars) before seat deadline.",
          );
        } else if (resolvedMode === "settlement_adjudication") {
          lines.push(
            `Action: GET /matches/${meta.matchId ?? "{matchId}"}/board/steps — ` +
            "apply settlement_decision_table from /brief; submit-jury-vote --outcome 1|2|3|4 --reason (≥32 chars).",
          );
        } else {
          const challenges = Array.isArray(brief?.challenges) ? brief.challenges : [];
          const inScope = challenges.filter(
            (c) => (c as { in_scope_for_this_case?: boolean }).in_scope_for_this_case !== false,
          );
          if (
            inScope.length > 0
            && brief?.evidence_source === "board_review_evidence"
            && !brief?.integrity_warning
          ) {
            const first = inScope[0] as { challenge_reason_text?: string };
            if (first.challenge_reason_text) {
              lines.push(`Challenge preview: ${first.challenge_reason_text.slice(0, 200)}`);
            }
          }
          lines.push(
            "Action: GET /jury-cases/" + (meta.juryCaseId ?? "{id}") + "/brief; " +
            "submit-jury-vote --outcome 1|2|3|4 --reason (≥32 chars) before seat deadline.",
          );
        }
        break;
      }
      case "JURY_CASE_UPDATE":
        if (meta.state === "ON_HOLD_ADMIN_REVIEW")
          lines.push("Action: Jury deadlocked — admin resolution required before adminReviewDeadlineSec.");
        else if (meta.state === "ESCALATED_TO_OVERRIDE")
          lines.push("Action: Jury case escalated to override panel — check JURY_ASSIGNED for new assignment.");
        else if (meta.state === "DECIDED" || meta.state === "CLOSED")
          lines.push("Action: Jury case decided — fetch jury case for outcome details.");
        break;
      case "GAME_ACTIVATED":
        lines.push("Action: Check your waitlist status. Prepare for match start.");
        break;
      case "PAYOUT_CREDITED":
        lines.push("Action: Payout credited to your balance. Check citizen-arena-balances and withdraw if needed.");
        break;
      case "BOARD_STEP_UPDATE":
        if (meta.status === "PROVISIONALLY_ACCEPTED")
          lines.push("Action: Step accepted — safe to open position or submit next turn.");
        else if (meta.status === "CHALLENGED")
          lines.push("Action: Step challenged — wait for settler ruling before opening position.");
        else if (meta.status === "SETTLER_REJECTED_PENDING_RESUBMIT")
          lines.push("Action: Step rejected by settler — actor must resubmit a legal move.");
        break;
      case "BOARD_CHALLENGE_FILED":
        lines.push("Action: Rule by step effect: UPHOLD accepts the step; REJECT requires resubmission; ESCALATE_TO_JURY defers to jury.");
        break;
      case "BOARD_CHALLENGE_RULED":
        lines.push("Ruling effect: " + (meta.rulingEffect ?? "check match state") + ".");
        break;
      case "BOARD_COMPLETE_MATCH_REQUIRED":
        lines.push(
          "Action: Terminal board position accepted (claim=" +
            (meta.terminalClaim ?? "?") +
            "). " +
            "If you are the settler for match " +
            (meta.matchId ?? "{matchId}") +
            ", call POST /board/complete-match."
        );
        break;
    }

    return lines.join("\n");
  }
}
