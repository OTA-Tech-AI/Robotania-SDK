import { describe, it, expect } from "vitest";
import {
  coerceGameType,
  coerceGameRewardMode,
  normalizeCreateGameParams,
} from "../src/game-terms.js";

describe("game-terms", () => {
  it("coerces topicType names and numbers", () => {
    expect(coerceGameType("debate_text")).toBe(0);
    expect(coerceGameType("board_duel")).toBe(1);
    expect(coerceGameType(1)).toBe(1);
    expect(coerceGameType("0")).toBe(0);
    expect(coerceGameType("invalid")).toBeUndefined();
  });

  it("coerces marketMode names and numbers", () => {
    expect(coerceGameRewardMode("VANILLA")).toBe(0);
    expect(coerceGameRewardMode("POPULARITY")).toBe(1);
    expect(coerceGameRewardMode("HYBRID")).toBe(2);
    expect(coerceGameRewardMode("ADVERSARIAL")).toBe(3);
    expect(coerceGameRewardMode(2)).toBe(2);
    expect(coerceGameRewardMode("2")).toBe(2);
    expect(coerceGameRewardMode("invalid")).toBeUndefined();
  });

  it("normalizeCreateGameParams coerces string topicType and marketMode to numbers", () => {
    const out = normalizeCreateGameParams({
      topicType: "board_duel",
      marketMode: "HYBRID",
      plannedTurnCount: 10,
    });
    expect(out.topicType).toBe(1);
    expect(out.marketMode).toBe(2);
    expect(out.plannedTurnCount).toBe(10);
  });

  it("normalizeCreateGameParams passes numeric topicType and marketMode through unchanged", () => {
    const out = normalizeCreateGameParams({ topicType: 0, marketMode: 3 });
    expect(out.topicType).toBe(0);
    expect(out.marketMode).toBe(3);
  });

  it("normalizeCreateGameParams throws on invalid topicType", () => {
    expect(() => normalizeCreateGameParams({ topicType: "unknown" })).toThrow();
  });

  it("normalizeCreateGameParams throws on invalid marketMode", () => {
    expect(() => normalizeCreateGameParams({ marketMode: "unknown" })).toThrow();
  });

  it("normalizeCreateGameParams is a no-op when topicType and marketMode are absent", () => {
    const out = normalizeCreateGameParams({ plannedTurnCount: 5, salaryBudgetBps: 500 });
    expect(out).toEqual({ plannedTurnCount: 5, salaryBudgetBps: 500 });
  });
});
