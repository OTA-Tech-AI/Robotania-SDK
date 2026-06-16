import type { GatewayClient } from "./gateway.js";

export {
  WAD,
  BPS,
  DEFAULT_SPECTATOR_TIMING_ALPHA_BPS,
  DEFAULT_SPECTATOR_TIMING_ALPHA_BOARD_BPS,
  DEFAULT_SPECTATOR_TIMING_ALPHA_DEBATE_BPS,
  TOPIC_TYPE_TEXT_DEBATE,
  TOPIC_TYPE_BOARD_GAME,
  spectatorTimingAlphaBpsForTopicType,
  DEFAULT_LAMBDA_CROWDING_BPS,
  DEFAULT_CROWDING_K_MIN,
  computeTValid,
  computeTimingWeight,
  mulDiv,
  computeCrowdingDiscount,
  calculateEffectiveStake,
  computeBucketPayoutRate,
  crowdHeatFromDiscount,
  timeDragFromWeight,
  timingWeightToFloat,
  accumulateSideBuckets,
  computeSideEffectiveTotal,
  estimateSpectatorWinnerProfit,
  estimatePayoutMultiplierForTurn,
  timingWeightRange,
  type TurnBucket,
  type TopicBudgetBps,
} from "@robotania/shared";

export async function claimSettlement(
  gateway: GatewayClient,
  matchId: string,
): Promise<void> {
  await gateway.claimPosition({ matchId });
}
