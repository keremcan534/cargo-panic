/**
 * Procedural wave generator for Endless mode.
 *
 * Nothing here ships to the player until the solver has proved it: every
 * candidate rack is run through a conveyor-order search that must find a way to
 * stow the whole manifest without the rack ever going red. Waves that fail are
 * rerolled with progressively looser constraints, and a trivially safe rack is
 * the last resort. `npm run validate` sweeps thousands of waves to show that
 * last resort never fires in practice.
 */

import { PACKAGE_SPECS } from './types';
import type { LevelDef, PackageType, ShelfDef } from './types';
import { Rng, waveSeed } from '../systems/Rng';
import type { Placement } from '../systems/BalanceSystem';
import { solve } from '../systems/Solver';

/**
 * Search budget per candidate. Deliberately small: a candidate that needs more
 * than this is pathological, and rerolling is cheaper than finishing the
 * search. Keeps worst-case generation well inside one dispatch animation.
 */
const NODE_BUDGET = 45_000;
const MAX_ATTEMPTS = 48;
/** Loosen the constraints a notch every this many failed rolls. */
const RELAX_EVERY = 6;

export interface WaveSpec {
  tiers: number;
  packages: number;
  tolerance: number;
  types: PackageType[];
  typeWeights: number[];
  allowPriority: boolean;
  allowLocked: boolean;
  /** Total shelf capacity as a multiple of the manifest weight. */
  capacitySlack: number;
  /**
   * Multiplier on the hazard grace periods. Package count and tolerance both
   * bottom out around wave 23; shrinking the time you get to fix a mistake is
   * what keeps the pressure climbing after that, and it costs the solver
   * nothing.
   */
  graceScale: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The difficulty curve, in one place. Wave 1 is two shelves of plain boxes;
 * each mechanic is introduced on its own before the next one arrives.
 */
export function specFor(wave: number): WaveSpec {
  const types: PackageType[] = ['standard'];
  const typeWeights: number[] = [5];
  if (wave >= 2) {
    types.push('heavy');
    typeWeights.push(3);
  }
  if (wave >= 4) {
    types.push('fragile');
    typeWeights.push(2.2);
  }
  if (wave >= 6) {
    types.push('long');
    typeWeights.push(1.6);
  }

  return {
    tiers: wave < 5 ? 2 : wave < 10 ? 3 : 4,
    packages: clamp(3 + Math.floor(wave * 0.55), 3, 11),
    tolerance: Math.max(3, Math.round((7 - wave * 0.18) * 2) / 2),
    types,
    typeWeights,
    allowPriority: wave >= 9,
    allowLocked: wave >= 12,
    capacitySlack: clamp(1.55 - wave * 0.012, 1.18, 1.55),
    graceScale: clamp(1 - (wave - 12) * 0.022, 0.5, 1),
  };
}

/** Human-readable label for the wave banner. */
export function waveObjective(level: LevelDef): string {
  const n = level.packages.length;
  return `Stow all ${n} packages, imbalance under ${level.balanceTolerance.toFixed(1)}`;
}

interface Candidate {
  shelves: ShelfDef[];
  packages: PackageType[];
  tolerance: number;
}

function rollCandidate(rng: Rng, spec: WaveSpec, relax: number): Candidate {
  const tiers = spec.tiers;

  // --- manifest -------------------------------------------------------------
  const packages: PackageType[] = [];
  const wantsPriority = spec.allowPriority && rng.chance(0.45);
  if (wantsPriority) packages.push('priority');
  while (packages.length < spec.packages) {
    packages.push(rng.weighted(spec.types, spec.typeWeights));
  }
  rng.shuffle(packages);

  const weight = packages.reduce((n, t) => n + PACKAGE_SPECS[t].weight, 0);
  const slotsNeeded = packages.reduce((n, t) => n + PACKAGE_SPECS[t].slots, 0);
  const heaviest = Math.max(...packages.map((t) => PACKAGE_SPECS[t].weight));

  // --- rack shape: wide at the bottom, narrowing as it climbs ---------------
  const slots: number[] = [];
  let width = tiers <= 2 ? rng.int(5, 7) : 7;
  for (let t = 0; t < tiers; t++) {
    slots.push(width);
    width = Math.max(5, width - rng.int(0, 1));
  }

  const lockedTier =
    spec.allowLocked && tiers >= 3 && rng.chance(0.22) ? rng.int(1, tiers - 1) : -1;
  const usable = tiers - (lockedTier >= 0 ? 1 : 0);

  // Enough room to physically hold the manifest, plus the relax margin.
  const usableSlots = slots.reduce((n, s, t) => (t === lockedTier ? n : n + s), 0);
  if (usableSlots < slotsNeeded) {
    for (let t = 0; t < tiers; t++) slots[t] = 7;
  }

  // --- capacities: bottom-heavy, but never enough to hold everything low ----
  const share = [1, 0.8, 0.62, 0.5];
  let shareTotal = 0;
  for (let t = 0; t < tiers; t++) if (t !== lockedTier) shareTotal += share[t];

  const target = Math.ceil(weight * (spec.capacitySlack + relax * 0.12));
  const caps: number[] = [];
  for (let t = 0; t < tiers; t++) {
    if (t === lockedTier) {
      caps.push(Math.max(heaviest, Math.ceil(weight * 0.4)));
      continue;
    }
    const raw = (target * share[t]) / shareTotal;
    caps.push(Math.max(heaviest, Math.ceil(raw)));
  }

  // Squeezing the base tier is what forces heavy crates upstairs, which in turn
  // is what makes the fragile-column rule bite.
  if (usable >= 3 && relax === 0) {
    caps[0] = Math.max(heaviest + 2, Math.min(caps[0], Math.ceil(weight * 0.62)));
  }

  const shelves: ShelfDef[] = slots.map((s, t) => {
    const def: ShelfDef = { slots: s, maxWeight: caps[t] };
    if (t === lockedTier) def.locked = true;
    return def;
  });

  // --- gold zone for priority cargo ----------------------------------------
  if (packages.includes('priority')) {
    const open: number[] = [];
    for (let t = 0; t < tiers; t++) if (t !== lockedTier) open.push(t);
    const tier = rng.pick(open);
    const from = rng.int(0, shelves[tier].slots - 2);
    shelves[tier].zone = { from, to: from + 2 };
  }

  return { shelves, packages, tolerance: spec.tolerance + relax * 0.5 };
}

function toLevel(wave: number, c: Candidate): LevelDef {
  return {
    id: wave,
    name: `WAVE ${wave}`,
    objective: '',
    shelves: c.shelves,
    packages: c.packages,
    balanceTolerance: c.tolerance,
  };
}

/** The rack used if every roll somehow fails. Plain boxes, lots of room. */
function safeFallback(wave: number, rng: Rng): LevelDef {
  const n = clamp(3 + Math.floor(wave * 0.3), 3, 8);
  return {
    id: wave,
    name: `WAVE ${wave}`,
    objective: '',
    shelves: [
      { slots: 7, maxWeight: n * 2 + 6 },
      { slots: 7, maxWeight: n * 2 + 6 },
    ],
    packages: new Array<PackageType>(n).fill('standard'),
    balanceTolerance: 6 + rng.next() * 0,
  };
}

export interface WavePlan {
  level: LevelDef;
  objective: string;
  /** Multiplier on the hazard grace periods for this wave. */
  graceScale: number;
  /**
   * The arrangement the solver proved, in conveyor order. Kept so callers can
   * re-verify the shipped wave without repeating the search.
   */
  solution: Placement[];
  /** How many candidates the solver had to reject. */
  attempts: number;
  /** True when the safety fallback was needed - should never happen. */
  fallback: boolean;
}

/**
 * Builds wave `wave` of the run identified by `runSeed`. Deterministic: the
 * same arguments always produce the same rack.
 */
export function generateWave(runSeed: number, wave: number): WavePlan {
  const rng = new Rng(waveSeed(runSeed, wave));
  const spec = specFor(wave);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const relax = Math.floor(attempt / RELAX_EVERY);
    const level = toLevel(wave, rollCandidate(rng, spec, relax));

    const ids = level.packages.map((_, i) => i);
    const res = solve(level, [], ids, {
      nodeBudget: NODE_BUDGET,
      prefixLimit: level.balanceTolerance,
    });
    if (!res.ok) continue;

    level.objective = waveObjective(level);
    return {
      level,
      objective: level.objective,
      graceScale: spec.graceScale,
      solution: res.placements,
      attempts: attempt + 1,
      fallback: false,
    };
  }

  const level = safeFallback(wave, rng);
  level.objective = waveObjective(level);
  const ids = level.packages.map((_, i) => i);
  const res = solve(level, [], ids, {
    nodeBudget: 400_000,
    prefixLimit: level.balanceTolerance,
  });
  return {
    level,
    objective: level.objective,
    graceScale: spec.graceScale,
    solution: res.placements,
    attempts: MAX_ATTEMPTS,
    fallback: true,
  };
}

// ---------------------------------------------------------------------------
// Prefetch cache
// ---------------------------------------------------------------------------

/**
 * Generation is deterministic, so the next wave can be built while the player
 * is still working on the current one. That hides the worst-case search behind
 * a shipment animation instead of a frame hitch.
 */
const cache = new Map<string, WavePlan>();
const CACHE_LIMIT = 4;

export function getWave(runSeed: number, wave: number): WavePlan {
  const key = `${runSeed}:${wave}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const plan = generateWave(runSeed, wave);
  cache.set(key, plan);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return plan;
}

/** Warms the cache for a wave the player has not reached yet. */
export function prefetchWave(runSeed: number, wave: number): void {
  getWave(runSeed, wave);
}
