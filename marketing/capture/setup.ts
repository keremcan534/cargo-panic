/**
 * Mid-shipment starting points for clips, built with the game's own code:
 * a real GameSession gets real `move` commands, and its snapshot becomes the
 * save's active game, which the menu's CONTINUE restores (paused, then RESUME).
 * Nothing is drawn or faked here; the game rebuilds the board itself.
 */

import { activeFrom, newShipment } from '../../src/app/activePlay';
import { getWave } from '../../src/game/levels/generator';
import { getLevel } from '../../src/game/levels/levels';
import { PACKAGE_SPECS } from '../../src/game/levels/types';
import type { ActivePlay } from '../../src/game/save/schema';
import { solve } from '../../src/game/systems/Solver';
import { newRun } from '../../src/game/systems/RunManager';
import type { Target } from './director';

export interface Move {
  id: number;
  shelf: number;
  slot: number;
}

/** A solver-proved way to stow a campaign level in conveyor order without the rack going red. */
export function campaignSolution(levelId: number): Move[] {
  const level = getLevel(levelId);
  const ids = level.packages.map((_, i) => i);
  const r = solve(level, [], ids, { prefixLimit: level.balanceTolerance });
  if (!r.ok) throw new Error(`no conveyor-order solution for level ${levelId}`);
  return r.placements.map((p) => ({ id: p.id, shelf: p.shelf, slot: p.slot }));
}

/** The generator's own proved solution for an Endless wave, in conveyor order. */
export function waveSolution(seed: number, wave: number): Move[] {
  return getWave(seed, wave).solution.map((p) => ({ id: p.id, shelf: p.shelf, slot: p.slot }));
}

export function targetOf(levelPackages: readonly string[], m: Move): Target {
  const type = levelPackages[m.id] as keyof typeof PACKAGE_SPECS;
  return { shelf: m.shelf, slot: m.slot, slots: PACKAGE_SPECS[type].slots };
}

/** A campaign level with `moves` already committed, as the save's active game. */
export function campaignActive(levelId: number, moves: Move[]): ActivePlay {
  const { session } = newShipment({ levelId });
  for (const m of moves) {
    if (!session.move(m.id, m.shelf, m.slot).ok) throw new Error(`setup move refused: ${JSON.stringify(m)}`);
  }
  const a = activeFrom(session, null);
  if (!a) throw new Error('setup finished the shipment');
  return a;
}

/** An Endless run on `seed` at `wave` with `moves` committed on that wave. */
export function endlessActive(seed: number, wave: number, moves: Move[], score = 0): ActivePlay {
  const run = newRun(seed, `store-${seed}`);
  run.wave = wave;
  run.score = score;
  run.rewardedThrough = wave - 1;
  const { session } = newShipment({ run });
  for (const m of moves) {
    if (!session.move(m.id, m.shelf, m.slot).ok) throw new Error(`setup move refused: ${JSON.stringify(m)}`);
  }
  const a = activeFrom(session, run);
  if (!a) throw new Error('setup finished the shipment');
  return a;
}
