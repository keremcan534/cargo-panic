/**
 * 3D quality profiles and the auto ladder (src/render/quality.ts): what each
 * preference draws with, the order auto steps down in, and when the stage
 * starts reporting that it is struggling.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AUTO_STEPS,
  HIGH_PROFILE,
  LOW_PROFILE,
  MAX_DPR,
  QualityGovernor,
  SLOW_FRAME_LIMIT,
  SLOW_FRAME_MS,
} from '../../src/render/quality';

const SLOW = SLOW_FRAME_MS + 10;
const FAST = 16;

/** Feeds frames until the governor reports a profile change (or gives up). Returns frames fed. */
function slowStretch(g: QualityGovernor): number {
  for (let i = 1; i <= SLOW_FRAME_LIMIT + 1; i++) if (g.frame(SLOW)) return i;
  return SLOW_FRAME_LIMIT + 1;
}

describe('quality profiles', () => {
  test('low: DPR 1, no bloom, no shadows, fewer particles; high: DPR cap 2, bloom, shadows', () => {
    assert.deepEqual({ ...LOW_PROFILE }, { bloom: false, shadows: false, dprCap: 1, particles: 0.4 });
    assert.deepEqual({ ...HIGH_PROFILE }, { bloom: true, shadows: true, dprCap: MAX_DPR, particles: 1 });
    assert.equal(MAX_DPR, 2);
    assert.deepEqual(new QualityGovernor('low').profile, LOW_PROFILE);
    assert.deepEqual(new QualityGovernor('high').profile, HIGH_PROFILE);
  });

  test('auto starts at high and drops bloom, then shadows, then DPR 1', () => {
    const g = new QualityGovernor('auto');
    assert.deepEqual(g.profile, HIGH_PROFILE);
    const seen = [g.profile];
    for (let i = 1; i < AUTO_STEPS.length; i++) {
      assert.equal(slowStretch(g), SLOW_FRAME_LIMIT + 1, 'one full slow stretch per step');
      seen.push(g.profile);
      assert.equal(g.struggling, false, 'not struggling while there is a step left');
    }
    assert.deepEqual(
      seen.map((p) => [p.bloom, p.shadows, p.dprCap]),
      [
        [true, true, 2],
        [false, true, 2],
        [false, false, 2],
        [false, false, 1],
      ],
    );
    // A further slow stretch at the bottom: struggling, and nothing else changes.
    assert.equal(slowStretch(g), SLOW_FRAME_LIMIT + 1);
    assert.equal(g.struggling, true);
    assert.deepEqual(g.profile, AUTO_STEPS[AUTO_STEPS.length - 1]);
  });

  test('fast frames pay the slow count back two for one, so short hitches never step down', () => {
    const g = new QualityGovernor('auto');
    for (let i = 0; i < 2000; i++) {
      assert.equal(g.frame(i % 3 === 0 ? SLOW : FAST), false);
    }
    assert.deepEqual(g.profile, HIGH_PROFILE);
  });

  test('low reports struggling after one slow stretch; high never steps down or struggles', () => {
    const low = new QualityGovernor('low');
    slowStretch(low);
    assert.equal(low.struggling, true);
    assert.deepEqual(low.profile, LOW_PROFILE);

    const high = new QualityGovernor('high');
    for (let i = 0; i < 5; i++) slowStretch(high);
    assert.equal(high.struggling, false);
    assert.deepEqual(high.profile, HIGH_PROFILE);
  });

  test('a new preference starts over', () => {
    const g = new QualityGovernor('auto');
    for (let i = 0; i < AUTO_STEPS.length; i++) slowStretch(g);
    assert.equal(g.struggling, true);
    g.setPreference('auto');
    assert.equal(g.struggling, false);
    assert.equal(g.autoStep, 0);
    assert.deepEqual(g.profile, HIGH_PROFILE);
    g.setPreference('low');
    assert.equal(g.preference, 'low');
    assert.deepEqual(g.profile, LOW_PROFILE);
  });
});
