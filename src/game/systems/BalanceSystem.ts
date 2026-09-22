/**
 * Deterministic rack balance model.
 *
 * There is no physics simulation anywhere in this game. Every package
 * contributes a fixed torque of `weight * offsetFromRackCentre * tierLeverage`,
 * and the same arrangement always produces exactly the same numbers. Pure
 * functions only, so the headless level validator can reuse them verbatim.
 */

import { CRUSH_WEIGHT, TIER_LEVERAGE_STEP } from '../config';
import { PACKAGE_SPECS, tierLeverage } from '../levels/types';
import type { LevelDef, PackageType, ShelfDef } from '../levels/types';

export interface Placement {
  /** Stable id matching the package's index in the level queue. */
  id: number;
  type: PackageType;
  /** Tier index, 0 = bottom shelf. */
  shelf: number;
  /** First occupied slot on that shelf. */
  slot: number;
}

export type BalanceStatus = 'stable' | 'risky' | 'danger';

export interface BoardEval {
  leftTorque: number;
  rightTorque: number;
  /** Signed net torque. Positive leans right, negative leans left. */
  net: number;
  imbalance: number;
  status: BalanceStatus;
  /** Total weight resting on each shelf, indexed by tier. */
  shelfWeights: number[];
  /** Tiers currently over their weight limit. */
  overloaded: number[];
  /** Placement ids of fragile cargo with something heavy in the column above. */
  crushed: number[];
  /** True when every priority package sits inside a gold zone. */
  prioritySatisfied: boolean;
}

/** Slot-space span of a placement, re-centred on the rack's midline. */
function span(shelf: ShelfDef, slot: number, slots: number): [number, number] {
  const half = shelf.slots / 2;
  return [slot - half, slot + slots - half];
}

/** Signed torque one package contributes to the whole rack. */
export function placementTorque(level: LevelDef, p: Placement): number {
  const spec = PACKAGE_SPECS[p.type];
  const shelf = level.shelves[p.shelf];
  const offset = p.slot + spec.slots / 2 - shelf.slots / 2;
  return spec.weight * offset * tierLeverage(p.shelf, TIER_LEVERAGE_STEP);
}

export function statusFor(imbalance: number, tolerance: number): BalanceStatus {
  if (imbalance <= tolerance * 0.5) return 'stable';
  if (imbalance <= tolerance) return 'risky';
  return 'danger';
}

export function evaluate(level: LevelDef, placements: Placement[]): BoardEval {
  let leftTorque = 0;
  let rightTorque = 0;
  const shelfWeights = new Array<number>(level.shelves.length).fill(0);

  for (const p of placements) {
    const t = placementTorque(level, p);
    if (t < 0) leftTorque -= t;
    else rightTorque += t;
    shelfWeights[p.shelf] += PACKAGE_SPECS[p.type].weight;
  }

  const net = rightTorque - leftTorque;
  const imbalance = Math.abs(net);

  const overloaded: number[] = [];
  for (let i = 0; i < level.shelves.length; i++) {
    if (shelfWeights[i] > level.shelves[i].maxWeight) overloaded.push(i);
  }

  const crushed: number[] = [];
  for (const f of placements) {
    if (f.type !== 'fragile') continue;
    const [fa, fb] = span(level.shelves[f.shelf], f.slot, PACKAGE_SPECS[f.type].slots);
    for (const h of placements) {
      if (h.shelf <= f.shelf) continue;
      if (PACKAGE_SPECS[h.type].weight < CRUSH_WEIGHT) continue;
      const [ha, hb] = span(level.shelves[h.shelf], h.slot, PACKAGE_SPECS[h.type].slots);
      if (ha < fb && fa < hb) {
        crushed.push(f.id);
        break;
      }
    }
  }

  let prioritySatisfied = true;
  for (const p of placements) {
    if (p.type !== 'priority') continue;
    const zone = level.shelves[p.shelf].zone;
    if (!zone || p.slot < zone.from || p.slot >= zone.to) {
      prioritySatisfied = false;
      break;
    }
  }

  return {
    leftTorque,
    rightTorque,
    net,
    imbalance,
    status: statusFor(imbalance, level.balanceTolerance),
    shelfWeights,
    overloaded,
    crushed,
    prioritySatisfied,
  };
}

/** Ids of the heavy packages sitting in the column above a fragile crate. */
export function crushersAbove(level: LevelDef, placements: Placement[], fragileId: number): number[] {
  const f = placements.find((p) => p.id === fragileId);
  if (!f || f.type !== 'fragile') return [];
  const [fa, fb] = span(level.shelves[f.shelf], f.slot, PACKAGE_SPECS[f.type].slots);
  const out: number[] = [];
  for (const h of placements) {
    if (h.shelf <= f.shelf) continue;
    if (PACKAGE_SPECS[h.type].weight < CRUSH_WEIGHT) continue;
    const [ha, hb] = span(level.shelves[h.shelf], h.slot, PACKAGE_SPECS[h.type].slots);
    if (ha < fb && fa < hb) out.push(h.id);
  }
  return out;
}

export type PlaceRejection =
  | 'locked'
  | 'occupied'
  | 'out-of-bounds'
  | 'priority-zone';

/**
 * Placement legality. Weight limits and fragile crushing are deliberately NOT
 * checked here: those are recoverable hazards with a grace period, not
 * forbidden moves. Only physically impossible drops are rejected.
 */
export function checkPlacement(
  level: LevelDef,
  placements: Placement[],
  type: PackageType,
  shelfIndex: number,
  slot: number,
  ignoreId = -1,
): PlaceRejection | null {
  // Targets are whole slots; NaN or fractional input (e.g. a hit-test on a
  // zero-sized canvas) is never a legal place.
  if (!Number.isInteger(shelfIndex) || !Number.isInteger(slot)) return 'out-of-bounds';
  const shelf = level.shelves[shelfIndex];
  if (!shelf) return 'out-of-bounds';
  if (shelf.locked) return 'locked';

  const width = PACKAGE_SPECS[type].slots;
  if (slot < 0 || slot + width > shelf.slots) return 'out-of-bounds';

  for (const p of placements) {
    if (p.id === ignoreId || p.shelf !== shelfIndex) continue;
    const w = PACKAGE_SPECS[p.type].slots;
    if (slot < p.slot + w && p.slot < slot + width) return 'occupied';
  }

  if (type === 'priority') {
    const zone = shelf.zone;
    if (!zone || slot < zone.from || slot + width > zone.to) return 'priority-zone';
  }

  return null;
}

export function rejectionMessage(r: PlaceRejection): string {
  switch (r) {
    case 'locked':
      return 'SHELF SEALED';
    case 'occupied':
      return 'NO ROOM THERE';
    case 'priority-zone':
      return 'PRIORITY CARGO -> GOLD ZONE';
    case 'out-of-bounds':
    default:
      return "DOESN'T FIT";
  }
}

/** True when the board is a finished, winning arrangement. */
export function isWinningBoard(level: LevelDef, placements: Placement[]): boolean {
  if (placements.length !== level.packages.length) return false;
  const ev = evaluate(level, placements);
  if (ev.overloaded.length > 0) return false;
  if (ev.crushed.length > 0) return false;
  if (!ev.prioritySatisfied) return false;
  const limit = level.finalBalanceMax ?? level.balanceTolerance;
  return ev.imbalance <= limit + 1e-9;
}

export { CRUSH_WEIGHT };
