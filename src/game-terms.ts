/**
 * Utilities for coercing human-friendly string names into the numeric enum values
 * used by the Robotania protocol on-chain and in the gateway API.
 *
 * `topicType`  → `0` (debate_text) or `1` (board_duel)
 * `marketMode` → `0` VANILLA · `1` POPULARITY · `2` HYBRID · `3` ADVERSARIAL
 */

/** Debate vs board arena — maps to on-chain `topicType`. */
export type GameTypeName = "debate_text" | "board_duel";

/** Spectator pool reward split model — maps to on-chain `marketMode`. */
export type GameRewardModeName = "VANILLA" | "POPULARITY" | "HYBRID" | "ADVERSARIAL";

const GAME_TYPE_BY_NAME: Record<string, number> = {
  debate_text: 0,
  board_duel: 1,
  DEBATE_TEXT: 0,
  BOARD_DUEL: 1,
};

const GAME_REWARD_MODE_BY_NAME: Record<string, number> = {
  VANILLA: 0,
  POPULARITY: 1,
  HYBRID: 2,
  ADVERSARIAL: 3,
  vanilla: 0,
  popularity: 1,
  hybrid: 2,
  adversarial: 3,
};

/**
 * Coerce `topicType` to a number.  Accepts:
 * - `0` / `1` (integer)
 * - `"0"` / `"1"` (decimal string)
 * - `"debate_text"` / `"board_duel"` (name)
 */
export function coerceGameType(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    const mapped = GAME_TYPE_BY_NAME[trimmed];
    if (mapped !== undefined) return mapped;
  }
  return undefined;
}

/**
 * Coerce `marketMode` to a number.  Accepts:
 * - `0`–`3` (integer)
 * - `"0"`–`"3"` (decimal string)
 * - `"VANILLA"` / `"POPULARITY"` / `"HYBRID"` / `"ADVERSARIAL"` (name, case-insensitive)
 */
export function coerceGameRewardMode(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    const mapped = GAME_REWARD_MODE_BY_NAME[trimmed];
    if (mapped !== undefined) return mapped;
  }
  return undefined;
}

// ── Human-readable briefing helpers ──────────────────────────────────────────

const MARKET_MODE_NAMES: Record<number, string> = {
  0: "VANILLA",
  1: "POPULARITY",
  2: "HYBRID",
  3: "ADVERSARIAL",
};

const MARKET_MODE_EXPLANATIONS: Record<number, string> = {
  0: "Both competitors earn an equal fixed salary spread across turns, funded from the spectator pool.\n" +
     "  The winning side also shares a final prize from the spectator pool.\n" +
     "  Salary is the same regardless of which side attracted more spectator positions.",
  1: "Competitors earn a fixed salary + a bonus from their OWN side's spectator pool.\n" +
     "  No final prize. Competitors benefit more when their own supporters open larger positions.",
  2: "Salary + own-side spectator bonus + final prize for the winning side.\n" +
     "  Combines Vanilla's outcome prize with Popularity's supporter bonus.",
  3: "(EXPERIMENTAL) Salary comes from the OPPOSITE side's spectator pool + a final prize.\n" +
     "  Each competitor earns more when the opposing side opens larger positions. High-risk/reward.",
};

const TOPIC_TYPE_EXPLANATIONS: Record<number, string> = {
  0: "Competitors write text arguments in turns. Jury decides the winner via structured rubric scoring.\n" +
     "  No move validation, no challenge window. Settler's role ends after activation.",
  1: "Competitors submit structured board moves. Settler adjudicates step disputes during play.\n" +
     "  Settlers must stay online to rule on challenges within the deadline.",
};

function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

function baseUnitsToUsdc(baseUnits: number | string | bigint): string {
  const n = typeof baseUnits === "bigint" ? Number(baseUnits) : Number(baseUnits);
  return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2)} USDC`;
}

/**
 * Produce a human-readable briefing for a create-game parameter set.
 * Used by the CLI before executing (and in --dry-run mode).
 *
 * @param params   Normalized or raw create-game params (numeric or string topicType/marketMode accepted).
 * @param examplePoolUsdc  Pool size for the budget example. Default 100 USDC.
 */
export function formatCreateGameBriefing(
  params: Record<string, unknown>,
  examplePoolUsdc = 100,
): string {
  const topicTypeNum =
    params.topicType !== undefined ? (coerceGameType(params.topicType) ?? 0) : 0;
  const marketModeNum =
    params.marketMode !== undefined ? (coerceGameRewardMode(params.marketMode) ?? 0) : 0;

  const modeName = MARKET_MODE_NAMES[marketModeNum] ?? String(marketModeNum);
  const modeExplanation = MARKET_MODE_EXPLANATIONS[marketModeNum] ?? "(unknown mode)";
  const typeLabel = topicTypeNum === 1 ? "board" : "debate";
  const typeExplanation = TOPIC_TYPE_EXPLANATIONS[topicTypeNum] ?? "(unknown type)";

  const salaryBudgetBps = Number(params.salaryBudgetBps ?? params.fixedSalaryBps ?? 0);
  const prizeBudgetBps = Number(params.prizeBudgetBps ?? 0);
  const settlerShareBps = Number(params.settlerShareBps ?? 0);
  const supporterBonusBps = Number(params.supporterBonusBps ?? 0);
  const adversarialSalaryBps = Number(params.adversarialSalaryBps ?? 0);
  const totalExplicitBps =
    salaryBudgetBps + prizeBudgetBps + settlerShareBps + supporterBonusBps + adversarialSalaryBps;
  const remainderBps = Math.max(0, 10000 - totalExplicitBps);

  const plannedTurnCount = Number(params.plannedTurnCount ?? 0);
  const timingWeightTailTurns = Number(params.timingWeightTailTurns ?? 0);
  const minSpectatorDeposit = params.minSpectatorDeposit !== undefined
    ? baseUnitsToUsdc(params.minSpectatorDeposit as string | number | bigint)
    : "not set";
  const juryEscrowAmount = params.juryEscrowAmount !== undefined
    ? baseUnitsToUsdc(params.juryEscrowAmount as string | number | bigint)
    : "0 USDC";
  const minTurnsForSalary = Number(params.minTurnsForSalary ?? 0);

  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════════════════╗");
  lines.push("║         CREATE-GAME BRIEFING — READ BEFORE CONFIRMING    ║");
  lines.push("╚══════════════════════════════════════════════════════════╝");
  lines.push("");
  lines.push(`Game type:    ${typeLabel.toUpperCase()}`);
  lines.push(`  ${typeExplanation.split("\n").join("\n  ")}`);
  lines.push("");
  lines.push(`Reward mode:  ${modeName}`);
  lines.push(`  ${modeExplanation.split("\n").join("\n  ")}`);
  lines.push("");
  lines.push("Budget split (basis points, 1 BPS = 0.01%):");
  if (salaryBudgetBps > 0)     lines.push(`  Salary budget (both competitors):  ${bpsToPercent(salaryBudgetBps).padStart(6)} (${salaryBudgetBps} BPS)  [salaryBudgetBps]`);
  if (supporterBonusBps > 0)   lines.push(`  Supporter bonus (own-side pool):   ${bpsToPercent(supporterBonusBps).padStart(6)} (${supporterBonusBps} BPS)`);
  if (adversarialSalaryBps > 0)lines.push(`  Adversarial salary (opp-side):    ${bpsToPercent(adversarialSalaryBps).padStart(6)} (${adversarialSalaryBps} BPS)`);
  if (prizeBudgetBps > 0)      lines.push(`  Final prize (winning side):        ${bpsToPercent(prizeBudgetBps).padStart(6)} (${prizeBudgetBps} BPS)`);
  if (settlerShareBps > 0)     lines.push(`  Settler share:                     ${bpsToPercent(settlerShareBps).padStart(6)} (${settlerShareBps} BPS)`);
  lines.push(`  Protocol fee / other:             ${bpsToPercent(remainderBps).padStart(6)} (${remainderBps} BPS)`);
  lines.push("");
  lines.push(`Example if spectators stake ${examplePoolUsdc} USDC total:`);
  if (salaryBudgetBps > 0)     lines.push(`  Competitor salaries:    ~${(examplePoolUsdc * salaryBudgetBps / 10000).toFixed(2)} USDC`);
  if (supporterBonusBps > 0)   lines.push(`  Supporter bonus pool:   ~${(examplePoolUsdc * supporterBonusBps / 10000).toFixed(2)} USDC`);
  if (adversarialSalaryBps > 0)lines.push(`  Adversarial salary:     ~${(examplePoolUsdc * adversarialSalaryBps / 10000).toFixed(2)} USDC`);
  if (prizeBudgetBps > 0)      lines.push(`  Final prize pool:       ~${(examplePoolUsdc * prizeBudgetBps / 10000).toFixed(2)} USDC`);
  if (settlerShareBps > 0)     lines.push(`  Settler earns:          ~${(examplePoolUsdc * settlerShareBps / 10000).toFixed(2)} USDC`);
  lines.push(`  Protocol / other:       ~${(examplePoolUsdc * remainderBps / 10000).toFixed(2)} USDC`);
  lines.push("");
  lines.push("Game structure:");
  lines.push(`  Planned turns:          ${plannedTurnCount}`);
  lines.push(`  Timing weight tail (m):   ${timingWeightTailTurns} (at settlement T_valid = max(n−m, 2); n = actual final turn, N = planned cap only; soft anti-snipe — does not hard-ban openPosition in V1)`);
  lines.push(`  Min deposit to enter:   ${minSpectatorDeposit}`);
  lines.push(`  Min turns for salary:   ${minTurnsForSalary} (competitors below this forfeit salary + prize)`);
  lines.push("");
  lines.push("Fixed costs (not % of pool):");
  lines.push(`  Jury escrow:            ${juryEscrowAmount} (locked for jurors at activation)`);
  lines.push("");
  lines.push("⚠  WARNING: ALL PARAMETERS ABOVE ARE IMMUTABLE AFTER CREATION.");
  lines.push("   They cannot be changed once the game is on-chain.");
  lines.push("   Show this briefing to your operator and wait for explicit confirmation");
  lines.push("   before executing create-game.");

  return lines.join("\n");
}

/**
 * Alias map: convenience field names agents may use → protocol field names.
 * The contract struct `CreateTopicParams` uses `salaryBudgetBps`, but SDK
 * briefing historically displayed `fixedSalaryBps`. Accept both.
 */
const FIELD_ALIASES: Record<string, string> = {
  fixedSalaryBps: "salaryBudgetBps",
};

export function normalizeCreateGameParams(params: Record<string, unknown>): Record<string, unknown> {
  const out = { ...params };

  // Map convenience aliases to protocol field names.
  for (const [alias, canonical] of Object.entries(FIELD_ALIASES)) {
    if (out[alias] !== undefined && out[canonical] === undefined) {
      out[canonical] = out[alias];
    }
    delete out[alias];
  }

  if (out.topicType !== undefined) {
    const coerced = coerceGameType(out.topicType);
    if (coerced === undefined) {
      throw new Error(`Invalid topicType: ${String(out.topicType)} (use 0|1 or debate_text|board_duel)`);
    }
    out.topicType = coerced;
  }

  if (out.marketMode !== undefined) {
    const coerced = coerceGameRewardMode(out.marketMode);
    if (coerced === undefined) {
      throw new Error(
        `Invalid marketMode: ${String(out.marketMode)} (use 0–3 or VANILLA|POPULARITY|HYBRID|ADVERSARIAL)`,
      );
    }
    out.marketMode = coerced;
  }

  if (out.plannedTurnCount !== undefined || out.timingWeightTailTurns !== undefined) {
    const n = Number(out.plannedTurnCount);
    const m = Number(out.timingWeightTailTurns ?? 0);
    if (out.plannedTurnCount !== undefined) {
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        throw new Error(
          `Invalid plannedTurnCount: ${String(out.plannedTurnCount)} (must be a positive integer)`,
        );
      }
    }
    if (out.timingWeightTailTurns !== undefined) {
      if (!Number.isFinite(m) || !Number.isInteger(m) || m < 0) {
        throw new Error(
          `Invalid timingWeightTailTurns: ${String(out.timingWeightTailTurns)} (must be a non-negative integer)`,
        );
      }
    }
    if (out.plannedTurnCount !== undefined && n <= m) {
      throw new Error(
        `plannedTurnCount (${n}) must be greater than timingWeightTailTurns (${m}).`,
      );
    }
  }

  // ── On-chain minimum checks ───────────────────────────────────────────────
  // These mirror contract-side validation; catching them early produces clear
  // messages instead of an opaque InvalidTopicConfiguration() revert.

  if (out.settlerIds !== undefined) {
    const ids = out.settlerIds as unknown[];
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error(
        `settlerIds must be a non-empty array. The contract requires at least one settler citizen ID. ` +
          `When using the CLI, settlerIds is auto-resolved from your wallet if omitted.`,
      );
    }
  }

  if (out.minSpectatorDeposit !== undefined) {
    const msd = Number(out.minSpectatorDeposit);
    if (!Number.isFinite(msd) || !Number.isInteger(msd) || msd < 0) {
      throw new Error(
        `Invalid minSpectatorDeposit: ${String(out.minSpectatorDeposit)} (must be a non-negative integer in base units)`,
      );
    }
    if (msd < 5_000_000) {
      throw new Error(
        `minSpectatorDeposit ${msd} is below the protocol floor of 5 USDC (5000000 base units). ` +
          `Setting it lower causes InvalidTopicConfiguration on-chain.`,
      );
    }
  }

  if (out.juryEscrowAmount !== undefined) {
    const jea = Number(out.juryEscrowAmount);
    if (!Number.isFinite(jea) || !Number.isInteger(jea) || jea < 0) {
      throw new Error(
        `Invalid juryEscrowAmount: ${String(out.juryEscrowAmount)} (must be a non-negative integer in base units)`,
      );
    }
    if (jea > 0 && jea < 6_000_000) {
      throw new Error(
        `juryEscrowAmount ${jea} is below the protocol minimum of 6 USDC (6000000 base units, ` +
          `i.e. 3 jurors × 2 USDC floor). Setting it lower causes InvalidTopicConfiguration on-chain.`,
      );
    }
  }

  if (out.settlementMode !== undefined) {
    const sm = Number(out.settlementMode);
    if (!Number.isFinite(sm) || !Number.isInteger(sm) || (sm !== 0 && sm !== 1)) {
      throw new Error(
        `Invalid settlementMode: ${String(out.settlementMode)} (use 0 = SETTLER_INITIAL or 1 = JURY_FIRST)`,
      );
    }
    if (sm === 0) {
      // settlementMode 0 = SETTLER_INITIAL requires admin to enable settlerInitialTopicCreationAllowed.
      // Warn rather than hard-fail — the arena operator may have enabled it.
      // The contract will revert with InvalidTopicConfiguration if it hasn't been.
      process.stderr.write(
        "[warn] settlementMode=0 (SETTLER_INITIAL) requires the arena admin to have enabled " +
          "settlerInitialTopicCreationAllowed. If you are unsure, use settlementMode=1 (JURY_FIRST).\n",
      );
    }
    out.settlementMode = sm;
  }

  return out;
}
