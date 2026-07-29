import type { GatewayClient } from "./gateway.js";

/** Mirrors on-chain SettlementMath using 1e18 fixed-point arithmetic. */
const WAD = 1_000_000_000_000_000_000n;
const BPS = 10_000n;

export function mulDiv(x: bigint, y: bigint, denom: bigint): bigint {
  if (denom === 0n) return 0n;
  return (x * y) / denom;
}

/**
 * T_valid = max(n − m, 2) at settlement (mirrors on-chain SettlementMath).
 * n = actual final turn count when the match ends; m = timingWeightTailTurns.
 * When n equals plannedTurnCount N, this equals max(N − m, 2).
 */
export function computeTValid(n: number, timingWeightTailTurns: number): number {
  if (n <= timingWeightTailTurns) return 2;
  const t = n - timingWeightTailTurns;
  return t < 2 ? 2 : t;
}

export function computeTimingWeight(t: number, tValid: number, alphaBps: number): bigint {
  if (tValid <= 1 || t <= 1) return WAD;
  const decay = (BigInt(alphaBps) * WAD * BigInt(t - 1)) / (BPS * BigInt(tValid - 1));
  return decay >= WAD ? 0n : WAD - decay;
}

export function computeCrowdingDiscount(
  bucketTimeWeightedStake: bigint,
  previousEffectiveStake: bigint,
  kMin: bigint,
  lambdaBps: bigint,
): bigint {
  const k = previousEffectiveStake > kMin ? previousEffectiveStake : kMin;
  if (k === 0n) return WAD;
  const scaled = (lambdaBps * bucketTimeWeightedStake * WAD) / (BPS * k);
  const onePlus = WAD + scaled;
  return mulDiv(WAD, WAD, onePlus);
}

export function calculateEffectiveStake(
  feeAdjustedStake: bigint,
  timingWeight: bigint,
  crowdingDiscount: bigint,
): bigint {
  return mulDiv(mulDiv(feeAdjustedStake, timingWeight, WAD), crowdingDiscount, WAD);
}

export async function claimSettlement(
  gateway: GatewayClient,
  matchId: string,
): Promise<void> {
  await gateway.claimPosition({ matchId });
}
