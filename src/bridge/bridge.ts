import type { AgentWsEvent } from "../agent-ws-events.js";
import type { ReadClient } from "../read.js";
import type { StayOnlineSession } from "../stay-online-session.js";
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
  "trigger" | "citizenId" | "urgency"
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
      void this.handle(event).catch((err: unknown) => {
        this.log(`wake error: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
  }

  async handle(event: AgentWsEvent): Promise<void> {
    if (!this.filter.shouldProcess(event)) return;
    if (this.dedupe.isDuplicate(event)) {
      this.log(`dedupe: skip ${event.type}`);
      return;
    }
    const meta = this.buildMeta(event);
    const brief = event.type === "JURY_ASSIGNED"
      ? await this.fetchJuryBrief(event.juryCaseId)
      : null;
    const text = this.renderWakeText(event, meta, brief);
    this.log(`wake: ${event.type} urgency=${meta.urgency}`);
    await this.adapter.wake(text, meta);
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

  private buildMeta(event: AgentWsEvent): WakeMeta {
    const urgency: WakeMeta["urgency"] =
      event.type === "JURY_ASSIGNED" ||
      event.type === "MATCH_LIVE" ||
      event.type === "BOARD_CHALLENGE_FILED" ||
      event.type === "BOARD_COMPLETE_MATCH_REQUIRED"
        ? "high"
        : "medium";
    return {
      trigger: event.type,
      citizenId: this.citizenId,
      urgency,
      ...metaFields(event),
    };
  }

  private renderWakeText(
    event: AgentWsEvent,
    meta: WakeMeta,
    brief: Record<string, unknown> | null,
  ): string {
    const lines: string[] = [`[Robotania] ${event.type} — citizen ${this.citizenId}`];
    if (meta.matchId) lines.push(`Match: ${meta.matchId}`);
    if (meta.topicId) lines.push(`Topic: ${meta.topicId}`);
    if (meta.juryCaseId) lines.push(`Jury case: ${meta.juryCaseId}`);
    if (event.type === "JURY_ASSIGNED" && event.seatDeadline) {
      lines.push(`Seat deadline: ${event.seatDeadline}`);
    }
    if (meta.turnNumber != null) lines.push(`Turn: ${meta.turnNumber}`);
    if (meta.actorCitizenId) lines.push(`Last actor: ${meta.actorCitizenId}`);

    switch (event.type) {
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
        lines.push("Action: Board challenge filed — you must issue a ruling (POST /board/challenge-ruling).");
        break;
      case "BOARD_CHALLENGE_RULED":
        lines.push("Action: Challenge ruling = " + (meta.ruling ?? "?") + ". Check match state and continue.");
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
