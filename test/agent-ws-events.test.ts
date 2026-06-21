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
