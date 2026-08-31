/**
 * Exhaustive-with-pruning search for a legal final arrangement.
 *
 * Two jobs: the in-game hint button asks it "where should this one go?", and
 * scripts/validate-levels.ts asks it "is every shipped level actually
 * solvable?". Same code path, so a level that validates is a level the hint
 * can always answer.
 */

import { CRUSH_WEIGHT, TIER_LEVERAGE_STEP } from '../config';
import { PACKAGE_SPECS, tierLeverage } from '../levels/types';
import type { LevelDef, PackageType } from '../levels/types';
import type { Placement } from './BalanceSystem';

export interface SolveOptions {
  /** Abort once this many search nodes have been expanded. */
  nodeBudget?: number;
  /** Override the imbalance the solution must land inside. */
  targetImbalance?: number;
  /**
   * Place packages strictly in conveyor order and never let the running
   * imbalance exceed this value. Proves a level can be played start to finish
   * without the rack ever going red.
   */
  prefixLimit?: number;
}

export interface SolveResult {
  ok: boolean;
  placements: Placement[];
  nodes: number;
  exhausted: boolean;
}

interface Candidate {
  shelf: number;
  slot: number;
  torque: number;
}

function candidatesFor(level: LevelDef, type: PackageType): Candidate[] {
  const spec = PACKAGE_SPECS[type];
  const out: Candidate[] = [];
  for (let t = 0; t < level.shelves.length; t++) {
    const shelf = level.shelves[t];
    if (shelf.locked) continue;
    if (spec.weight > shelf.maxWeight) continue;
    const lev = tierLeverage(t, TIER_LEVERAGE_STEP);
    for (let s = 0; s + spec.slots <= shelf.slots; s++) {
      if (type === 'priority') {
        const z = shelf.zone;
        if (!z || s < z.from || s + spec.slots > z.to) continue;
      }
      const offset = s + spec.slots / 2 - shelf.slots / 2;
      out.push({ shelf: t, slot: s, torque: spec.weight * offset * lev });
    }
  }
  return out;
}

/** Sort key that makes identical packages non-interchangeable during search. */
function posKey(c: { shelf: number; slot: number }): number {
  return c.shelf * 1000 + c.slot;
}

export function solve(
  level: LevelDef,
  fixed: Placement[],
  freeIds: number[],
  opts: SolveOptions = {},
): SolveResult {
  const nodeBudget = opts.nodeBudget ?? 400_000;
  const limit = opts.targetImbalance ?? level.finalBalanceMax ?? level.balanceTolerance;
  const prefixLimit = opts.prefixLimit;
  const inOrder = prefixLimit !== undefined;
  const tiers = level.shelves.length;

  // --- mutable search state -------------------------------------------------
  const occupied: boolean[][] = level.shelves.map((s) => new Array<boolean>(s.slots).fill(false));
  const shelfWeight = new Array<number>(tiers).fill(0);
  const chosen: Placement[] = [];
  let net = 0;

  // Fragile/heavy spans are tracked in rack-centred slot units so shelves of
  // different widths still line up into real vertical columns.
  const fragiles: { tier: number; a: number; b: number }[] = [];
  const heavies: { tier: number; a: number; b: number }[] = [];

  const spanOf = (tier: number, slot: number, slots: number): [number, number] => {
    const half = level.shelves[tier].slots / 2;
    return [slot - half, slot + slots - half];
  };

  const apply = (p: Placement, spec = PACKAGE_SPECS[p.type]) => {
    for (let i = 0; i < spec.slots; i++) occupied[p.shelf][p.slot + i] = true;
    shelfWeight[p.shelf] += spec.weight;
    const [a, b] = spanOf(p.shelf, p.slot, spec.slots);
    if (p.type === 'fragile') fragiles.push({ tier: p.shelf, a, b });
    if (spec.weight >= CRUSH_WEIGHT) heavies.push({ tier: p.shelf, a, b });
  };

  const undo = (p: Placement, spec = PACKAGE_SPECS[p.type]) => {
    for (let i = 0; i < spec.slots; i++) occupied[p.shelf][p.slot + i] = false;
    shelfWeight[p.shelf] -= spec.weight;
    if (p.type === 'fragile') fragiles.pop();
    if (spec.weight >= CRUSH_WEIGHT) heavies.pop();
  };

  const crushFree = (type: PackageType, tier: number, slot: number): boolean => {
    const spec = PACKAGE_SPECS[type];
    const [a, b] = spanOf(tier, slot, spec.slots);
    if (type === 'fragile') {
      for (const h of heavies) if (h.tier > tier && h.a < b && a < h.b) return false;
    }
    if (spec.weight >= CRUSH_WEIGHT) {
      for (const f of fragiles) if (f.tier < tier && f.a < b && a < f.b) return false;
    }
    return true;
  };

  // Seed with the placements the player has already committed to.
  for (const p of fixed) {
    apply(p);
    chosen.push(p);
    const spec = PACKAGE_SPECS[p.type];
    const offset = p.slot + spec.slots / 2 - level.shelves[p.shelf].slots / 2;
    net += spec.weight * offset * tierLeverage(p.shelf, TIER_LEVERAGE_STEP);
  }

  // Conveyor order when we are proving a playable path; otherwise heaviest and
  // widest first, because the most constrained packages fail fastest.
  const order = inOrder
    ? [...freeIds].sort((x, y) => x - y)
    : [...freeIds].sort((x, y) => {
        const a = PACKAGE_SPECS[level.packages[x]];
        const b = PACKAGE_SPECS[level.packages[y]];
        if (b.slots !== a.slots) return b.slots - a.slots;
        if (b.weight !== a.weight) return b.weight - a.weight;
        return x - y;
      });

  const candCache = new Map<PackageType, Candidate[]>();
  const candsFor = (type: PackageType) => {
    let c = candCache.get(type);
    if (!c) {
      c = candidatesFor(level, type);
      candCache.set(type, c);
    }
    return c;
  };

  // Upper bound on how far the remaining packages can still swing the net.
  const swingSuffix = new Array<number>(order.length + 1).fill(0);
  for (let i = order.length - 1; i >= 0; i--) {
    const cs = candsFor(level.packages[order[i]]);
    let max = 0;
    for (const c of cs) max = Math.max(max, Math.abs(c.torque));
    swingSuffix[i] = swingSuffix[i + 1] + max;
  }

  // Remaining weight vs remaining capacity, and remaining slots vs free slots.
  const weightSuffix = new Array<number>(order.length + 1).fill(0);
  const slotSuffix = new Array<number>(order.length + 1).fill(0);
  for (let i = order.length - 1; i >= 0; i--) {
    const spec = PACKAGE_SPECS[level.packages[order[i]]];
    weightSuffix[i] = weightSuffix[i + 1] + spec.weight;
    slotSuffix[i] = slotSuffix[i + 1] + spec.slots;
  }

  let nodes = 0;
  let exhausted = false;
  let solution: Placement[] | null = null;

  const freeCapacity = () => {
    let cap = 0;
    for (let t = 0; t < tiers; t++) {
      if (level.shelves[t].locked) continue;
      cap += level.shelves[t].maxWeight - shelfWeight[t];
    }
    return cap;
  };

  const freeSlots = () => {
    let n = 0;
    for (let t = 0; t < tiers; t++) {
      if (level.shelves[t].locked) continue;
      for (let s = 0; s < occupied[t].length; s++) if (!occupied[t][s]) n++;
    }
    return n;
  };

  const recurse = (idx: number, lastKeyByType: Map<PackageType, number>): boolean => {
    if (nodes++ > nodeBudget) {
      exhausted = true;
      return false;
    }
    if (idx === order.length) {
      if (Math.abs(net) <= limit + 1e-9) {
        solution = chosen.map((p) => ({ ...p }));
        return true;
      }
      return false;
    }

    if (Math.abs(net) - swingSuffix[idx] > limit + 1e-9) return false;
    if (weightSuffix[idx] > freeCapacity()) return false;
    if (slotSuffix[idx] > freeSlots()) return false;

    const id = order[idx];
    const type = level.packages[id];
    const spec = PACKAGE_SPECS[type];
    // Interchangeable packages are only interchangeable when arrival order does
    // not matter, so the symmetry break is off in conveyor-order mode.
    const minKey = inOrder ? -1 : (lastKeyByType.get(type) ?? -1);

    // Prefer positions that pull the rack back towards level.
    const cands = candsFor(type)
      .filter((c) => posKey(c) > minKey)
      .sort((a, b) => Math.abs(net + a.torque) - Math.abs(net + b.torque));

    for (const c of cands) {
      if (shelfWeight[c.shelf] + spec.weight > level.shelves[c.shelf].maxWeight) continue;

      let free = true;
      for (let i = 0; i < spec.slots; i++) {
        if (occupied[c.shelf][c.slot + i]) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      if (!crushFree(type, c.shelf, c.slot)) continue;
      if (prefixLimit !== undefined && Math.abs(net + c.torque) > prefixLimit + 1e-9) continue;

      const p: Placement = { id, type, shelf: c.shelf, slot: c.slot };
      apply(p, spec);
      chosen.push(p);
      net += c.torque;
      const prev = lastKeyByType.get(type);
      lastKeyByType.set(type, posKey(c));

      if (recurse(idx + 1, lastKeyByType)) return true;

      if (prev === undefined) lastKeyByType.delete(type);
      else lastKeyByType.set(type, prev);
      net -= c.torque;
      chosen.pop();
      undo(p, spec);
    }
    return false;
  };

  recurse(0, new Map());

  return {
    ok: solution !== null,
    placements: solution ?? [],
    nodes,
    exhausted,
  };
}

export interface Hint {
  kind: 'place' | 'rearrange' | 'stuck';
  shelf: number;
  slot: number;
}

/**
 * Where the current package should go. Falls back to solving the board from
 * scratch when the committed placements have painted the player into a corner,
 * so the hint can say "this needs rearranging" instead of "no idea".
 */
export function hintFor(
  level: LevelDef,
  placed: Placement[],
  pendingIds: number[],
  currentId: number,
): Hint {
  const direct = solve(level, placed, pendingIds, { nodeBudget: 120_000 });
  if (direct.ok) {
    const spot = direct.placements.find((p) => p.id === currentId);
    if (spot) return { kind: 'place', shelf: spot.shelf, slot: spot.slot };
  }

  const allIds = [...placed.map((p) => p.id), ...pendingIds];
  const scratch = solve(level, [], allIds, { nodeBudget: 200_000 });
  if (scratch.ok) {
    const spot = scratch.placements.find((p) => p.id === currentId);
    if (spot) return { kind: 'rearrange', shelf: spot.shelf, slot: spot.slot };
  }

  return { kind: 'stuck', shelf: -1, slot: -1 };
}
