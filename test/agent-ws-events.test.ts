import { describe, expect, it } from "vitest";
import { parseAgentWsEvent } from "../src/agent-ws-events.js";

describe("parseAgentWsEvent", () => {
  it("parses TURN_SUBMITTED", () => {
    const ev = parseAgentWsEvent({
      type: "TURN_SUBMITTED",
      matchId: "42",
      turnNumber: 3,
      actorCitizenId: "9",
    });
    expect(ev).toEqual({
      type: "TURN_SUBMITTED",
      matchId: "42",
      turnNumber: 3,
      actorCitizenId: "9",
    });
  });

  it("returns null for unknown type", () => {
    expect(parseAgentWsEvent({ type: "NOPE" })).toBeNull();
  });

  it("parses Practice lifecycle and jury events", () => {
    expect(parseAgentWsEvent({
      type: "PRACTICE_MATCH_LIVE",
      practiceMatchId: "pm_1",
      practiceArenaId: "pa_1",
      state: "LIVE",
    })).toEqual({
      type: "PRACTICE_MATCH_LIVE",
      practiceMatchId: "pm_1",
      practiceArenaId: "pa_1",
      state: "LIVE",
    });
    expect(parseAgentWsEvent({
      type: "PRACTICE_JURY_ASSIGNED",
      practiceJuryCaseId: "pj_1",
      practiceMatchId: "pm_1",
      practiceArenaId: "pa_1",
    })).toEqual({
      type: "PRACTICE_JURY_ASSIGNED",
      practiceJuryCaseId: "pj_1",
      practiceMatchId: "pm_1",
      practiceArenaId: "pa_1",
    });
    expect(parseAgentWsEvent({
      type: "PRACTICE_TURN_SUBMITTED",
      practiceMatchId: "pm_1",
      practiceArenaId: "pa_1",
      turnNumber: 3,
      actorCitizenId: "7",
    })).toEqual({
      type: "PRACTICE_TURN_SUBMITTED",
      practiceMatchId: "pm_1",
      practiceArenaId: "pa_1",
      turnNumber: 3,
      actorCitizenId: "7",
    });
    expect(parseAgentWsEvent({
      type: "PRACTICE_BOARD_STEP_SUBMITTED",
      practiceMatchId: "pm_1",
      practiceArenaId: "pa_1",
      stepId: "pbs_1",
      turnNumber: 3,
      actorCitizenId: "7",
      challengeDeadlineAt: "2026-07-27T00:10:00.000Z",
    })).toMatchObject({
      type: "PRACTICE_BOARD_STEP_SUBMITTED",
      practiceMatchId: "pm_1",
      stepId: "pbs_1",
      turnNumber: 3,
    });
  });

  it("parses BOARD_STEP_SETTLED", () => {
    expect(
      parseAgentWsEvent({
        type: "BOARD_STEP_SETTLED",
        matchId: "7",
        settledAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toEqual({
      type: "BOARD_STEP_SETTLED",
      matchId: "7",
      settledAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("preserves the explicit effect of a Board challenge ruling", () => {
    expect(parseAgentWsEvent({
      type: "PRACTICE_BOARD_CHALLENGE_RULED",
      practiceMatchId: "pm_1",
      stepId: "pbs_1",
      challengeId: "pbc_1",
      turnNumber: 3,
      ruling: "UPHOLD",
      rulingEffect: "STEP_ACCEPTED",
    })).toMatchObject({ ruling: "UPHOLD", rulingEffect: "STEP_ACCEPTED" });
    expect(parseAgentWsEvent({
      type: "BOARD_CHALLENGE_RULED",
      matchId: "7",
      ruling: "REJECT",
      rulingEffect: "RESUBMISSION_REQUIRED",
    })).toMatchObject({ ruling: "REJECT", rulingEffect: "RESUBMISSION_REQUIRED" });
  });

  it("parses BOARD_AUTO_ESCALATED and BOARD_SETTLER_RULING_DEADLINE", () => {
    expect(
      parseAgentWsEvent({
        type: "BOARD_AUTO_ESCALATED",
        matchId: "7",
        stepId: "s1",
        autoEscalatedAt: "2026-01-02T00:00:00.000Z",
      }),
    ).toMatchObject({ type: "BOARD_AUTO_ESCALATED", matchId: "7", stepId: "s1" });

    expect(
      parseAgentWsEvent({
        type: "BOARD_SETTLER_RULING_DEADLINE",
        matchId: "7",
        settlerRulingDeadlineAt: "2026-01-02T12:00:00.000Z",
      }),
    ).toMatchObject({
      type: "BOARD_SETTLER_RULING_DEADLINE",
      matchId: "7",
      settlerRulingDeadlineAt: "2026-01-02T12:00:00.000Z",
    });
  });
});
