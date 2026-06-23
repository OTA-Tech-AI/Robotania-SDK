import { describe, it, expect } from "vitest";
import { collectTopicBudgetBpsWarnings } from "../src/topic-budget-bps.js";

describe("collectTopicBudgetBpsWarnings", () => {
  it("flags typo-suspect 3000 BPS as likely 300", () => {
    const w = collectTopicBudgetBpsWarnings({ salaryBudgetBps: 3000 });
    expect(w.some((x) => x.code === "typo_suspect")).toBe(true);
  });

  it("cap sum mirrors TopicFactory (core + max side-linked) + platform", () => {
    const w = collectTopicBudgetBpsWarnings({
      salaryBudgetBps: 5000,
      prizeBudgetBps: 5000,
      settlerShareBps: 500,
      supporterBonusBps: 200,
      adversarialSalaryBps: 300,
    });
    expect(w.some((x) => x.code === "total_exceeds_cap")).toBe(true);
  });
});
