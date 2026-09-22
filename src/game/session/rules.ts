/**
 * Judgement rules that sit on top of the balance model: what still blocks a
 * finish, how a campaign finish is starred, how an Endless shipment is scored.
 * Pure functions; the ruleset version in versions.ts covers every number here.
 */

import type { LevelDef } from '../levels/types';
import { PACKAGE_SPECS } from '../levels/types';
import type { BoardEval } from '../systems/BalanceSystem';
import { scoreWave } from '../systems/RunManager';
import type { WaveResult } from '../systems/RunManager';
import type { ShipmentOutcome } from './types';

/** Why a fully stowed board still cannot finish. Keys map to UI copy. */
export type BlockReason =
  | { key: 'overloaded' }
  | { key: 'crushed' }
  | { key: 'priority' }
  | { key: 'imbalance'; limit: number };

export function finishLimit(level: LevelDef): number {
  return level.finalBalanceMax ?? level.balanceTolerance;
}

export function blockingReason(level: LevelDef, placedCount: number, ev: BoardEval): BlockReason | null {
  if (placedCount < level.packages.length) return null;
  if (ev.overloaded.length > 0) return { key: 'overloaded' };
  if (ev.crushed.length > 0) return { key: 'crushed' };
  if (!ev.prioritySatisfied) return { key: 'priority' };
  const limit = finishLimit(level);
  if (ev.imbalance > limit) return { key: 'imbalance', limit };
  return null;
}

/**
 * Campaign stars (ruleset 1, unchanged from the pre-refactor game): three
 * for a finish within 40% of the limit with no hint and no refused drop; two
 * otherwise; one after three or more refused drops.
 */
export function campaignStars(o: ShipmentOutcome): number {
  let stars = 3;
  if (o.assists.hints > 0 || o.rejectedDrops > 0 || o.imbalance > o.limit * 0.4) stars = 2;
  if (o.rejectedDrops >= 3) stars = 1;
  return stars;
}

export function manifestWeight(level: LevelDef): number {
  return level.packages.reduce((n, t) => n + PACKAGE_SPECS[t].weight, 0);
}

/** Endless shipment score (ruleset 1). */
export function shipmentScore(level: LevelDef, wave: number, o: ShipmentOutcome): WaveResult {
  return scoreWave({
    wave,
    manifestWeight: manifestWeight(level),
    imbalance: o.imbalance,
    tolerance: level.balanceTolerance,
    mistakes: o.rejectedDrops,
    hintUsed: o.assists.hints > 0,
  });
}
