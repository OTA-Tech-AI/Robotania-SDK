/**
 * Topic pool budget BPS sanity checks (100 bps = 1%).
 * Mirrors TopicFactory caps while keeping the published SDK dependency-independent.
 */

/** Default platform fee when not overridden (matches on-chain config default). */
const DEFAULT_PLATFORM_FEE_BPS = 400;
const TOPIC_BPS_HIGH_THRESHOLD = 1000;
const TOPIC_BPS_CAP = 10_000;

export interface TopicBudgetBpsInput {
  salaryBudgetBps?: number;
  prizeBudgetBps?: number;
  settlerShareBps?: number;
  supporterBonusBps?: number;
  adversarialSalaryBps?: number;
  platformFeeBps?: number;
}

export type TopicBudgetBpsWarningCode = "high_bps" | "typo_suspect" | "total_exceeds_cap";

export interface TopicBudgetBpsWarning {
  code: TopicBudgetBpsWarningCode;
  field: string;
  bps: number;
  message: string;
}

const BUDGET_FIELDS: Array<{ key: keyof TopicBudgetBpsInput; label: string }> = [
  { key: "salaryBudgetBps", label: "salaryBudgetBps" },
  { key: "prizeBudgetBps", label: "prizeBudgetBps" },
  { key: "settlerShareBps", label: "settlerShareBps" },
  { key: "supporterBonusBps", label: "supporterBonusBps" },
  { key: "adversarialSalaryBps", label: "adversarialSalaryBps" },
];

const CORE_CAP_FIELDS: Array<keyof TopicBudgetBpsInput> = [
  "salaryBudgetBps",
  "prizeBudgetBps",
  "settlerShareBps",
];

function bpsToPctLabel(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

function typoSuspectMessage(field: string, bps: number): string | null {
  if (bps < 1000 || bps % 10 !== 0) return null;
  const alt = bps / 10;
  if (alt < 50 || alt > 2000) return null;
  return (
    `${field}=${bps} BPS (${bpsToPctLabel(bps)}) looks high — did you mean ${alt} BPS (${bpsToPctLabel(alt)})?`
  );
}

export function collectTopicBudgetBpsWarnings(input: TopicBudgetBpsInput): TopicBudgetBpsWarning[] {
  const warnings: TopicBudgetBpsWarning[] = [];
  const platformFeeBps = Number(input.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS);

  let coreTotal = 0;
  for (const key of CORE_CAP_FIELDS) {
    const raw = input[key];
    if (raw == null) continue;
    const bps = Number(raw);
    if (Number.isFinite(bps) && bps >= 0) coreTotal += bps;
  }

  for (const { key, label } of BUDGET_FIELDS) {
    const raw = input[key];
    if (raw == null) continue;
    const bps = Number(raw);
    if (!Number.isFinite(bps) || bps < 0) continue;

    if (bps >= TOPIC_BPS_HIGH_THRESHOLD) {
      warnings.push({
        code: "high_bps",
        field: label,
        bps,
        message: `${label}=${bps} BPS (${bpsToPctLabel(bps)}) is unusually high for a spectator pool slice.`,
      });
    }

    const typo = typoSuspectMessage(label, bps);
    if (typo) {
      warnings.push({
        code: "typo_suspect",
        field: label,
        bps,
        message: typo,
      });
    }
  }

  const sideLinked = Math.max(
    Number(input.supporterBonusBps ?? 0),
    Number(input.adversarialSalaryBps ?? 0),
  );
  const totalWithPlatform = coreTotal + sideLinked + platformFeeBps;
  if (totalWithPlatform > TOPIC_BPS_CAP) {
    warnings.push({
      code: "total_exceeds_cap",
      field: "total",
      bps: totalWithPlatform,
      message:
        `Topic budgets sum to ${totalWithPlatform} BPS (salary+prize+settler ${coreTotal} + side-linked up to ${sideLinked} + platform ${platformFeeBps}), ` +
        `which exceeds the ${TOPIC_BPS_CAP} BPS on-chain cap.`,
    });
  }

  return warnings;
}
