/**
 * The title screen's hero rack: one shape and one set of cargo, drawn by the
 * 3D menu backdrop (three/backdrops.ts) and the 2D one (canvas2d/backdrops2d.ts).
 *
 * Plain data with no renderer imports, so the 2D path can use it without
 * loading three.js.
 */

import type { LevelDef, PackageType } from '../game/levels/types';

export const HERO_LEVEL: LevelDef = {
  id: 0,
  name: 'HERO',
  objective: '',
  shelves: [
    { slots: 6, maxWeight: 99 },
    { slots: 6, maxWeight: 99 },
  ],
  packages: [],
  balanceTolerance: 99,
};

/** [type, tier, slot] of every package on the hero rack. */
export const HERO_CARGO: readonly (readonly [PackageType, number, number])[] = [
  ['heavy', 1, 0],
  ['standard', 1, 1],
  ['fragile', 1, 3],
  ['standard', 1, 4],
  ['long', 0, 0],
  ['priority', 0, 4],
];
