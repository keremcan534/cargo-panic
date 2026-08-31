/**
 * Endless generator QA. Run with `npm run validate:endless`.
 *
 * Sweeps thousands of generated waves and proves that every one of them:
 *   - avoided the safety fallback,
 *   - has a legal finishing arrangement the balance rules accept, and
 *   - can be played straight down the conveyor without the rack going red.
 *
 * Also reports generation cost, so a wave never stalls the game on a phone.
 */

import { generateWave, specFor } from '../src/game/levels/generator';
import { PACKAGE_SPECS } from '../src/game/levels/types';
import type { PackageType } from '../src/game/levels/types';
import { evaluate, isWinningBoard } from '../src/game/systems/BalanceSystem';
import { solve } from '../src/game/systems/Solver';

const SEEDS = Number(process.argv[2] ?? 120);
const MAX_WAVE = Number(process.argv[3] ?? 40);

let failures = 0;
let fallbacks = 0;
let worstMs = 0;
let totalMs = 0;
let count = 0;
let totalAttempts = 0;
let worstAttempts = 0;

const typeCounts: Record<string, number> = {};
const perWave = new Map<number, { pkgs: number; tol: number; ms: number; grace: number; n: number }>();

function fail(msg: string) {
  failures++;
  if (failures <= 20) console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`);
}

console.log(`\nCARGO PANIC - endless generator sweep (${SEEDS} seeds x ${MAX_WAVE} waves)\n`);

for (let s = 0; s < SEEDS; s++) {
  // Spread seeds across the 32-bit space rather than using 0..N.
  const seed = (Math.imul(s + 1, 0x9e3779b1) ^ 0x5bf03635) >>> 0;

  for (let wave = 1; wave <= MAX_WAVE; wave++) {
    const t0 = performance.now();
    const plan = generateWave(seed, wave);
    const ms = performance.now() - t0;

    count++;
    totalMs += ms;
    worstMs = Math.max(worstMs, ms);
    totalAttempts += plan.attempts;
    worstAttempts = Math.max(worstAttempts, plan.attempts);

    if (plan.fallback) {
      fallbacks++;
      fail(`seed ${seed} wave ${wave} fell back to the safe rack`);
    }

    const level = plan.level;
    for (const t of level.packages) typeCounts[t] = (typeCounts[t] ?? 0) + 1;

    const bucket = perWave.get(wave) ?? { pkgs: 0, tol: 0, ms: 0, grace: 0, n: 0 };
    bucket.pkgs += level.packages.length;
    bucket.tol += level.balanceTolerance;
    bucket.ms += ms;
    bucket.grace += plan.graceScale;
    bucket.n++;
    perWave.set(wave, bucket);

    // --- structural sanity --------------------------------------------------
    const spec = specFor(wave);
    if (level.shelves.length !== spec.tiers) {
      fail(`seed ${seed} wave ${wave}: ${level.shelves.length} tiers, expected ${spec.tiers}`);
    }
    for (const sh of level.shelves) {
      if (sh.slots < 5 || sh.slots > 7) fail(`seed ${seed} wave ${wave}: shelf width ${sh.slots}`);
      if (sh.zone && (sh.zone.from < 0 || sh.zone.to > sh.slots)) {
        fail(`seed ${seed} wave ${wave}: zone outside the shelf`);
      }
      if (sh.zone && sh.locked) fail(`seed ${seed} wave ${wave}: gold zone on a sealed shelf`);
    }
    const hasPriority = level.packages.includes('priority');
    const hasZone = level.shelves.some((sh) => sh.zone && !sh.locked);
    if (hasPriority !== hasZone) {
      fail(`seed ${seed} wave ${wave}: priority cargo and gold zone disagree`);
    }
    const unlocked = new Set<PackageType>(spec.types);
    if (spec.allowPriority) unlocked.add('priority');
    for (const t of level.packages) {
      if (!unlocked.has(t)) fail(`seed ${seed} wave ${wave}: ${t} is not unlocked yet`);
    }
    for (const t of new Set(level.packages)) {
      const fits = level.shelves.some(
        (sh) => !sh.locked && sh.slots >= PACKAGE_SPECS[t].slots && sh.maxWeight >= PACKAGE_SPECS[t].weight,
      );
      if (!fits) fail(`seed ${seed} wave ${wave}: a ${t} package fits nowhere`);
    }

    // --- verify the artifact the generator actually shipped -----------------
    // Checking the returned arrangement is a stronger test than re-running the
    // search: it proves the level handed to the player is the level that was
    // proved, and it cannot produce a false negative from a search budget.
    if (!isWinningBoard(level, plan.solution)) {
      fail(`seed ${seed} wave ${wave}: shipped solution is not a winning board`);
    }
    if (plan.solution.length !== level.packages.length) {
      fail(`seed ${seed} wave ${wave}: solution does not cover the manifest`);
    }
    for (const p of plan.solution) {
      if (level.packages[p.id] !== p.type) {
        fail(`seed ${seed} wave ${wave}: solution disagrees with the manifest`);
      }
      if (level.shelves[p.shelf]?.locked) {
        fail(`seed ${seed} wave ${wave}: solution uses a sealed shelf`);
      }
    }
    const ev = evaluate(level, plan.solution);
    if (ev.overloaded.length || ev.crushed.length || !ev.prioritySatisfied) {
      fail(`seed ${seed} wave ${wave}: shipped solution violates a rule`);
    }

    // And prove the conveyor-order path independently of the generator's own
    // search, with a budget generous enough that exhaustion is not a false no.
    const ids = level.packages.map((_, i) => i);
    const ordered = solve(level, [], ids, {
      nodeBudget: 4_000_000,
      prefixLimit: level.balanceTolerance,
    });
    if (!ordered.ok) {
      fail(
        `seed ${seed} wave ${wave}: no conveyor-order path found` +
          ` (exhausted=${ordered.exhausted})`,
      );
    }
  }
}

console.log('  wave  pkgs   tol  grace   gen ms');
console.log('  --------------------------------');
for (const wave of [1, 2, 4, 6, 9, 12, 15, 20, 25, 30, 35, 40]) {
  const b = perWave.get(wave);
  if (!b) continue;
  console.log(
    `  ${String(wave).padStart(4)}  ${(b.pkgs / b.n).toFixed(1).padStart(4)}` +
      `  ${(b.tol / b.n).toFixed(1).padStart(4)}` +
      `  ${(b.grace / b.n).toFixed(2).padStart(5)}` +
      `  ${(b.ms / b.n).toFixed(2).padStart(7)}`,
  );
}

console.log('\n  cargo mix:');
const totalPkgs = Object.values(typeCounts).reduce((a, b) => a + b, 0);
for (const [t, n] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${t.padEnd(10)} ${((n / totalPkgs) * 100).toFixed(1).padStart(5)}%`);
}

console.log(
  `\n  ${count} waves | avg ${(totalMs / count).toFixed(2)}ms | worst ${worstMs.toFixed(1)}ms` +
    ` | avg ${(totalAttempts / count).toFixed(2)} rolls | worst ${worstAttempts} rolls`,
);
console.log(`  fallbacks: ${fallbacks}`);

if (failures === 0) {
  console.log(`\n  \x1b[32mAll ${count} generated waves are sound.\x1b[0m\n`);
} else {
  console.log(`\n  \x1b[31m${failures} problem(s).\x1b[0m\n`);
  process.exit(1);
}
