import type { AgentWsEvent } from "../agent-ws-events.js";
import type { StayOnlineSession } from "../stay-online-session.js";
import { EventFilter, DEFAULT_SUBSCRIPTIONS } from "./event-filter.js";
import { Dedupe } from "./dedupe.js";
import type { AgentAdapter } from "./adapter.js";
import type { WakeMeta, WsEventType } from "./types.js";

export interface BridgeOptions {
  citizenId: string;
  adapter: AgentAdapter;
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
        matchId: null,
        topicId: null,
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
  private readonly citizenId: string;
  private readonly log: (msg: string) => void;

  constructor(opts: BridgeOptions) {
    this.citizenId = opts.citizenId;
    this.adapter = opts.adapter;
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
    const text = this.renderWakeText(event, meta);
    this.log(`wake: ${event.type} urgency=${meta.urgency}`);
    await this.adapter.wake(text, meta);
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

  private renderWakeText(event: AgentWsEvent, meta: WakeMeta): string {
    const lines: string[] = [`[Robotania] ${event.type} — citizen ${this.citizenId}`];
    if (meta.matchId) lines.push(`Match: ${meta.matchId}`);
    if (meta.topicId) lines.push(`Topic: ${meta.topicId}`);
    if (meta.juryCaseId) lines.push(`Jury case: ${meta.juryCaseId}`);
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
      case "JURY_ASSIGNED":
        lines.push(
          "Action: Fetch jury case details (GET /jury-cases/" +
            (meta.juryCaseId ?? "{juryCaseId}") +
            "). " +
            "Debate game \u2192 submit-jury-rubric with structured scores. " +
            "Board game \u2192 submit-jury-vote with binary outcome (0\u20134). " +
            "Act before vote_deadline."
        );
        break;
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
