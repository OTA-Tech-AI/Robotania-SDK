import { describe, it, expect } from "vitest";
import {
  computeTValid,
  computeTimingWeight,
  calculateEffectiveStake,
  mulDiv,
} from "../src/economy.js";

const WAD = 1_000_000_000_000_000_000n;

describe("economy", () => {
  it("computeTValid = max(n - m, 2) when n > m", () => {
    expect(computeTValid(24, 2)).toBe(22);
    expect(computeTValid(10, 2)).toBe(8);
    expect(computeTValid(13, 2)).toBe(11);
  });

  it("computeTValid clamps when N <= m", () => {
    expect(computeTValid(2, 2)).toBe(2);
    expect(computeTValid(1, 3)).toBe(2);
  });

  it("computeTimingWeight is WAD at turn 1", () => {
    expect(computeTimingWeight(1, 10, 3000)).toBe(WAD);
  });

  it("computeTimingWeight decays toward turn T_valid", () => {
    const tValid = 10;
    const wFirst = computeTimingWeight(1, tValid, 3000);
    const wLast = computeTimingWeight(tValid, tValid, 3000);
    expect(wFirst).toBe(WAD);
    expect(wLast).toBeLessThan(wFirst);
    expect(wLast).toBe((WAD * 7n) / 10n);
  });

  it("calculateEffectiveStake applies weight and crowding", () => {
    const stake = 1_000_000n;
    const half = WAD / 2n;
    expect(calculateEffectiveStake(stake, WAD, WAD)).toBe(stake);
    expect(calculateEffectiveStake(stake, half, WAD)).toBe(stake / 2n);
    expect(calculateEffectiveStake(stake, WAD, half)).toBe(stake / 2n);
  });

  it("mulDiv handles zero denominator", () => {
    expect(mulDiv(100n, 200n, 0n)).toBe(0n);
  });
});
