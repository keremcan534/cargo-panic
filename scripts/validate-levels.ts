/**
 * Headless level QA. Run with `npm run validate`.
 *
 * For every shipped level this proves:
 *   - the manifest physically fits (slots and weight capacity),
 *   - a legal finishing arrangement exists inside the level's balance limit,
 *   - and a three-star finish (imbalance <= 40% of tolerance) is reachable.
 *
 * Exits non-zero if any level fails, so it can gate a release.
 */

import { LEVELS } from '../src/game/levels/levels';
import { PACKAGE_SPECS } from '../src/game/levels/types';
import type { LevelDef } from '../src/game/levels/types';
import { evaluate, isWinningBoard } from '../src/game/systems/BalanceSystem';
import { solve } from '../src/game/systems/Solver';

const BUDGET = 1_500_000;
const MAX_SHELVES = 4;
const MAX_SLOTS = 7;

let failures = 0;

function fail(level: LevelDef, msg: string) {
  failures++;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`);
  void level;
}

/** Smallest imbalance (on a 0.25 grid) that still admits a full solution. */
function bestImbalance(level: LevelDef, ceiling: number): number | null {
  const ids = level.packages.map((_, i) => i);
  if (!solve(level, [], ids, { nodeBudget: BUDGET, targetImbalance: ceiling }).ok) return null;

  const step = 0.25;
  let lo = 0;
  let hi = Math.round(ceiling / step);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const ok = solve(level, [], ids, { nodeBudget: BUDGET, targetImbalance: mid * step }).ok;
    if (ok) hi = mid;
    else lo = mid + 1;
  }
  return lo * step;
}

console.log('\nCARGO PANIC - level validation\n');
console.log('  #  name                 pkgs  wt/cap  slot/free  limit  best  3star  order');
console.log('  ------------------------------------------------------------------------');

for (const level of LEVELS) {
  // --- structural sanity ----------------------------------------------------
  if (level.shelves.length < 1 || level.shelves.length > MAX_SHELVES) {
    fail(level, `L${level.id} has ${level.shelves.length} shelves (max ${MAX_SHELVES})`);
  }
  for (const s of level.shelves) {
    if (s.slots < 3 || s.slots > MAX_SLOTS) fail(level, `L${level.id} shelf width ${s.slots}`);
    if (s.zone && (s.zone.from < 0 || s.zone.to > s.slots || s.zone.from >= s.zone.to)) {
      fail(level, `L${level.id} has an out-of-range gold zone`);
    }
  }

  const hasPriority = level.packages.includes('priority');
  const hasZone = level.shelves.some((s) => s.zone && !s.locked);
  if (hasPriority && !hasZone) fail(level, `L${level.id} has priority cargo but no usable zone`);
  if (hasZone && !hasPriority) fail(level, `L${level.id} has a gold zone but no priority cargo`);

  const zoneSlots = level.shelves
    .filter((s) => !s.locked && s.zone)
    .reduce((n, s) => n + (s.zone!.to - s.zone!.from), 0);
  const priorityCount = level.packages.filter((p) => p === 'priority').length;
  if (priorityCount > zoneSlots) fail(level, `L${level.id} zone is too small for its priority cargo`);

  // --- capacity sanity ------------------------------------------------------
  const totalWeight = level.packages.reduce((n, t) => n + PACKAGE_SPECS[t].weight, 0);
  const totalSlots = level.packages.reduce((n, t) => n + PACKAGE_SPECS[t].slots, 0);
  const capWeight = level.shelves.filter((s) => !s.locked).reduce((n, s) => n + s.maxWeight, 0);
  const capSlots = level.shelves.filter((s) => !s.locked).reduce((n, s) => n + s.slots, 0);

  if (totalWeight > capWeight) fail(level, `L${level.id} weight ${totalWeight} > capacity ${capWeight}`);
  if (totalSlots > capSlots) fail(level, `L${level.id} needs ${totalSlots} slots, rack has ${capSlots}`);

  // Long packages need a shelf wide enough to actually take them.
  for (const t of new Set(level.packages)) {
    const spec = PACKAGE_SPECS[t];
    const fits = level.shelves.some((s) => !s.locked && s.slots >= spec.slots && s.maxWeight >= spec.weight);
    if (!fits) fail(level, `L${level.id} has a ${t} package that fits nowhere`);
  }

  // --- solvability ----------------------------------------------------------
  const limit = level.finalBalanceMax ?? level.balanceTolerance;
  const ids = level.packages.map((_, i) => i);
  const res = solve(level, [], ids, { nodeBudget: BUDGET });

  let bestStr = '  -  ';
  let starStr = ' -- ';
  let orderStr = ' -- ';

  if (!res.ok) {
    fail(level, `L${level.id} "${level.name}" is UNSOLVABLE (nodes=${res.nodes}, exhausted=${res.exhausted})`);
  } else {
    if (!isWinningBoard(level, res.placements)) {
      fail(level, `L${level.id} solver returned a board that isWinningBoard() rejects`);
    }
    const ev = evaluate(level, res.placements);
    if (ev.overloaded.length) fail(level, `L${level.id} solution overloads shelf ${ev.overloaded.join(',')}`);
    if (ev.crushed.length) fail(level, `L${level.id} solution crushes fragile cargo`);
    if (!ev.prioritySatisfied) fail(level, `L${level.id} solution leaves priority cargo outside the zone`);

    const best = bestImbalance(level, limit);
    if (best === null) {
      fail(level, `L${level.id} best-imbalance search disagreed with the solver`);
    } else {
      bestStr = best.toFixed(2).padStart(5);
      const threeStar = limit * 0.4;
      if (best <= threeStar + 1e-9) {
        starStr = ' \x1b[32mOK\x1b[0m ';
      } else {
        starStr = ' \x1b[31mNO\x1b[0m ';
        fail(
          level,
          `L${level.id} cannot reach 3 stars: best imbalance ${best} > ${threeStar.toFixed(2)}`,
        );
      }
    }

    // The stronger guarantee: playable straight down the conveyor without the
    // rack ever going red, so no level ever *requires* the grace period.
    const inOrder = solve(level, [], ids, {
      nodeBudget: BUDGET,
      prefixLimit: level.balanceTolerance,
    });
    if (inOrder.ok) {
      orderStr = ' [32mOK[0m ';
    } else {
      orderStr = ' [31mNO[0m ';
      fail(
        level,
        `L${level.id} has no conveyor-order path that stays out of the red ` +
          `(nodes=${inOrder.nodes}, exhausted=${inOrder.exhausted})`,
      );
    }
  }

  const name = level.name.padEnd(20).slice(0, 20);
  console.log(
    `  ${String(level.id).padStart(2)}  ${name} ${String(level.packages.length).padStart(4)}` +
      `  ${String(totalWeight).padStart(2)}/${String(capWeight).padEnd(3)}` +
      `  ${String(totalSlots).padStart(4)}/${String(capSlots).padEnd(4)}` +
      `  ${limit.toFixed(1).padStart(5)}  ${bestStr}  ${starStr}  ${orderStr}`,
  );
}

// --- global checks ----------------------------------------------------------
const ids = LEVELS.map((l) => l.id);
if (new Set(ids).size !== ids.length) {
  failures++;
  console.log('\n  \x1b[31mFAIL\x1b[0m  duplicate level ids');
}
for (let i = 0; i < ids.length; i++) {
  if (ids[i] !== i + 1) {
    failures++;
    console.log(`\n  \x1b[31mFAIL\x1b[0m  level ids are not sequential at index ${i}`);
    break;
  }
}
if (LEVELS.length !== 25) {
  failures++;
  console.log(`\n  \x1b[31mFAIL\x1b[0m  expected 25 levels, found ${LEVELS.length}`);
}

console.log('');
if (failures === 0) {
  console.log(`  \x1b[32mAll ${LEVELS.length} levels are solvable and three-star reachable.\x1b[0m\n`);
} else {
  console.log(`  \x1b[31m${failures} problem(s) found.\x1b[0m\n`);
  process.exit(1);
}
