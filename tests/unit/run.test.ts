/**
 * Endless run rewards: a cleared wave pays out exactly once, and a same-seed
 * retry is a different run.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWave } from '../../src/game/levels/generator';
import { GameSession, nextWave, rewardWave, waveRewardId, waveSource } from '../../src/game/session';
import type { RunState } from '../../src/game/systems/RunManager';
import type { ShipmentOutcome } from '../../src/game/session';
import { newRun } from '../../src/game/systems/RunManager';

function winWave(run: RunState): { outcome: ShipmentOutcome; level: ReturnType<typeof generateWave>['level'] } {
  const plan = generateWave(run.seed, run.wave);
  const s = new GameSession(plan.level, { source: waveSource(run), graceScale: plan.graceScale });
  for (const p of plan.solution) assert.equal(s.move(p.id, p.shelf, p.slot).ok, true);
  let out = s.tick(0);
  for (let i = 0; i < 200 && !out.outcome; i++) out = s.tick(16);
  assert.equal(out.outcome?.result, 'won');
  return { outcome: out.outcome!, level: plan.level };
}

test('a won wave is rewarded once, however many times it is reported', () => {
  const run = newRun(777);
  const { outcome, level } = winWave(run);
  const first = rewardWave(run, level, outcome);
  assert.equal(first.applied, true);
  const score = run.score;
  assert.ok(score > 0);
  assert.equal(rewardWave(run, level, outcome).applied, false);
  // A resumed copy of the same run state (e.g. from a save) is also protected.
  const resumed = JSON.parse(JSON.stringify(run));
  assert.equal(rewardWave(resumed, level, outcome).applied, false);
  assert.equal(resumed.score, score);
});

test('the next wave only starts after the current one was rewarded', () => {
  const run = newRun(777);
  assert.equal(nextWave(run), false);
  const { outcome, level } = winWave(run);
  rewardWave(run, level, outcome);
  assert.equal(nextWave(run), true);
  assert.equal(run.wave, 2);
  assert.equal(nextWave(run), false, 'wave 2 not rewarded yet');
});

test('a failed wave pays nothing', () => {
  const run = newRun(5);
  const { outcome, level } = winWave(run);
  assert.equal(rewardWave(run, level, { ...outcome, result: 'failed' }).applied, false);
  assert.equal(run.score, 0);
});

test('a same-seed retry is a new run with its own reward ids', () => {
  const a = newRun(1234);
  const b = newRun(1234);
  assert.equal(a.seed, b.seed);
  assert.notEqual(a.runId, b.runId);
  assert.notEqual(waveRewardId(a), waveRewardId(b));
});

test('help used in a wave marks the whole run assisted', () => {
  const run = newRun(9);
  const { outcome, level } = winWave(run);
  rewardWave(run, level, { ...outcome, assists: { hints: 0, undos: 1 } });
  assert.equal(run.assisted, true);
});

test('a wave-1 outcome reported again after advancing pays nothing and skips nothing', () => {
  const run = newRun(777);
  const { outcome, level } = winWave(run);
  rewardWave(run, level, outcome);
  nextWave(run);
  const score = run.score;
  assert.equal(rewardWave(run, level, outcome).applied, false);
  assert.equal(nextWave(run), false);
  assert.equal(run.score, score);
  assert.equal(run.wave, 2);
});

test('an outcome from another run of the same seed is never paid', () => {
  const a = newRun(1234);
  const b = newRun(1234);
  const { outcome, level } = winWave(a);
  assert.equal(rewardWave(b, level, outcome).applied, false);
  assert.equal(b.score, 0);
});

test('a restored won snapshot of an earlier wave next to a later run pays nothing', () => {
  const run = newRun(777);
  const plan = generateWave(run.seed, 1);
  const s = new GameSession(plan.level, { source: waveSource(run), graceScale: plan.graceScale });
  for (const p of plan.solution) s.move(p.id, p.shelf, p.slot);
  for (let i = 0; i < 200 && s.phase === 'play'; i++) s.tick(16);
  const snap = s.snapshot();
  rewardWave(run, plan.level, s.outcome!);
  nextWave(run);
  const restored = GameSession.restore(plan.level, JSON.parse(JSON.stringify(snap)));
  assert.equal(restored.phase, 'won');
  assert.equal(rewardWave(run, plan.level, restored.outcome!).applied, false);
});
