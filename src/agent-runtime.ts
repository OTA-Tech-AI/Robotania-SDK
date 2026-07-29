export type AgentArenaMode = "VERIFIED" | "PRACTICE";
export type AgentAuthorityKind =
  | "CHAIN_PROJECTED"
  | "GATEWAY_COMMITTED"
  | "PRACTICE_COMMITTED";
export type AgentRole = "SETTLER" | "COMPETITOR" | "SPECTATOR" | "JURY";
export type AgentAction =
  | "SUBMIT_TURN"
  | "REVIEW_OPPONENT_STEP"
  | "ACK_STEP"
  | "CHALLENGE_STEP"
  | "RULE_ON_CHALLENGE"
  | "RESUBMIT_TURN"
  | "COMPLETE_MATCH"
  | "SUBMIT_JURY_VOTE"
  | "SUBMIT_JURY_RUBRIC";

export interface AgentTask {
  taskId: string;
  revision: string;
  arenaMode: AgentArenaMode;
  authority: { kind: AgentAuthorityKind; revision: string };
  role: AgentRole;
  action: AgentAction;
  subject: {
    arenaId: string;
    matchId?: string;
    stepId?: string;
    challengeId?: string;
    juryCaseId?: string;
  };
  allowedActions: AgentAction[];
  activeDeadline: {
    kind: "TURN" | "CHALLENGE" | "RULING" | "RESUBMIT" | "JURY";
    at: string;
  } | null;
  contextReference: string;
}

export interface DurableAgentEvent {
  sequence: number;
  eventId: string;
  arenaMode: AgentArenaMode;
  eventType: string;
  aggregateKind: string;
  aggregateId: string;
  revision: string;
  createdAt: string;
  message: { type: string; [key: string]: unknown };
}

export interface AgentEventsPage {
  events: DurableAgentEvent[];
  /** Pass this value as `afterSequence` for the next page. */
  nextSequence: number;
  watermarkSequence: number;
  retentionFloorSequence: number;
}

export interface AgentTasksResult {
  tasks: AgentTask[];
  generatedAt: string;
  /** Server time at which this task list was generated. */
  serverNow: string;
}

export interface AgentCanonicalReadReferences {
  match?: string;
  board?: string;
  boardSteps?: string;
  juryCase?: string;
}

export interface AgentTaskContext {
  task: AgentTask;
  context: Record<string, unknown>;
  canonicalReads: AgentCanonicalReadReferences;
  revision: string;
  generatedAt: string;
}
