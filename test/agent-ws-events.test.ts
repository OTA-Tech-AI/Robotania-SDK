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
});
