import { describe, it, expect } from "vitest";
import { EventFilter, DEFAULT_SUBSCRIPTIONS } from "../../src/bridge/event-filter.js";

describe("EventFilter", () => {
  it("passes actionable events with default subscriptions", () => {
    const f = new EventFilter();
    for (const type of DEFAULT_SUBSCRIPTIONS) {
      expect(f.shouldProcess({ type })).toBe(true);
    }
  });

  it("blocks non-subscribed events", () => {
    const f = new EventFilter();
    expect(f.shouldProcess({ type: "GAME_STATE_CHANGE" })).toBe(false);
    expect(f.shouldProcess({ type: "MATCH_STATE_CHANGE" })).toBe(false);
    expect(f.shouldProcess({ type: "CONNECTED" })).toBe(false);
    expect(f.shouldProcess({ type: "SETTLEMENT_VOTE_REQUIRED" })).toBe(false);
  });

  it("respects custom subscription list", () => {
    const f = new EventFilter(["JURY_ASSIGNED"]);
    expect(f.shouldProcess({ type: "JURY_ASSIGNED" })).toBe(true);
    expect(f.shouldProcess({ type: "MATCH_LIVE" })).toBe(false);
  });
});
