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

/**
 * Normalize `createGame` params for the gateway relay:
 * - Accepts protocol field names (`topicType`, `marketMode`) directly.
 * - Also accepts convenience aliases: `topicType` also accepts string names.
 *   `marketMode` also accepts string names.
 *
 * The returned object uses only protocol field names ready for the relay endpoint.
 */
export function normalizeCreateGameParams(params: Record<string, unknown>): Record<string, unknown> {
  const out = { ...params };

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

  return out;
}
