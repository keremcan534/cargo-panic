/**
 * Endless run bookkeeping on top of single shipments: applying a cleared
 * wave's reward exactly once, and moving to the next wave.
 */

import type { LevelDef } from '../levels/types';
import type { RunState, WaveResult } from '../systems/RunManager';
import { shipmentScore } from './rules';
import type { ShipmentOutcome } from './types';

/** Stable id of one wave's reward in one run. */
export function waveRewardId(run: RunState): string {
  return `endless:${run.runId}:w${run.wave}`;
}

/**
 * Applies the reward for the run's current wave if (and only if) it was won
 * and has not been rewarded yet. Returns the score breakdown either way, and
 * whether anything was applied - a repeated callback, a double tap or a
 * resumed snapshot of an already-rewarded wave changes nothing.
 */
export function rewardWave(
  run: RunState,
  level: LevelDef,
  outcome: ShipmentOutcome,
): { applied: boolean; result: WaveResult } {
  const result = shipmentScore(level, run.wave, outcome);
  if (outcome.result !== 'won' || run.rewardedThrough >= run.wave) return { applied: false, result };
  run.score += result.total;
  run.stowed += level.packages.length;
  if (result.clean) run.cleanWaves++;
  if (outcome.assists.hints > 0 || outcome.assists.undos > 0) run.assisted = true;
  run.rewardedThrough = run.wave;
  return { applied: true, result };
}

/** Moves to the next wave once the current one has been rewarded. */
export function nextWave(run: RunState): boolean {
  if (run.rewardedThrough < run.wave) return false;
  run.wave++;
  return true;
}
