import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dedupe } from "../../src/bridge/dedupe.js";
import type { AgentWsEvent } from "../../src/agent-ws-events.js";

describe("Dedupe", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("allows first occurrence", () => {
    const d = new Dedupe(5_000);
    const ev: AgentWsEvent = { type: "MATCH_LIVE", matchId: "7", state: "LIVE" };
    expect(d.isDuplicate(ev)).toBe(false);
  });

  it("blocks repeat within window", () => {
    const d = new Dedupe(5_000);
    const ev: AgentWsEvent = { type: "MATCH_LIVE", matchId: "7", state: "LIVE" };
    d.isDuplicate(ev);
    vi.advanceTimersByTime(4_999);
    expect(d.isDuplicate(ev)).toBe(true);
  });

  it("allows repeat after window expires", () => {
    const d = new Dedupe(5_000);
    const ev: AgentWsEvent = { type: "MATCH_LIVE", matchId: "7", state: "LIVE" };
    d.isDuplicate(ev);
    vi.advanceTimersByTime(5_001);
    expect(d.isDuplicate(ev)).toBe(false);
  });

  it("distinguishes different matches for MATCH_LIVE", () => {
    const d = new Dedupe(5_000);
    d.isDuplicate({ type: "MATCH_LIVE", matchId: "7", state: "LIVE" });
    expect(d.isDuplicate({ type: "MATCH_LIVE", matchId: "8", state: "LIVE" })).toBe(false);
  });

  it("distinguishes different turn numbers for TURN_SUBMITTED", () => {
    const d = new Dedupe(5_000);
    d.isDuplicate({ type: "TURN_SUBMITTED", matchId: "7", turnNumber: 1, actorCitizenId: "1" });
    expect(
      d.isDuplicate({ type: "TURN_SUBMITTED", matchId: "7", turnNumber: 2, actorCitizenId: "1" }),
    ).toBe(false);
  });

  it("blocks same turn within window", () => {
    const d = new Dedupe(5_000);
    const ev: AgentWsEvent = {
      type: "TURN_SUBMITTED",
      matchId: "7",
      turnNumber: 3,
      actorCitizenId: "1",
    };
    d.isDuplicate(ev);
    expect(d.isDuplicate(ev)).toBe(true);
  });

  it("distinguishes JURY_ASSIGNED by case id", () => {
    const d = new Dedupe(5_000);
    d.isDuplicate({ type: "JURY_ASSIGNED", juryCaseId: "10" });
    expect(d.isDuplicate({ type: "JURY_ASSIGNED", juryCaseId: "11" })).toBe(false);
    expect(d.isDuplicate({ type: "JURY_ASSIGNED", juryCaseId: "10" })).toBe(true);
  });

  it("distinguishes GAME_ACTIVATED by topic id", () => {
    const d = new Dedupe(5_000);
    d.isDuplicate({ type: "GAME_ACTIVATED", topicId: "3", matchId: "1" });
    expect(d.isDuplicate({ type: "GAME_ACTIVATED", topicId: "4", matchId: "2" })).toBe(false);
    expect(d.isDuplicate({ type: "GAME_ACTIVATED", topicId: "3", matchId: "1" })).toBe(true);
  });
});
