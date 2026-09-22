/**
 * Golden check of the A0 behaviour snapshot. A failure here means level data,
 * wave generation, the balance model, the hint solver or scoring changed. If
 * that was deliberate, bump the ruleset/generator version and run
 * `npm run baseline` to regenerate the fixture.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildBaseline } from '../../scripts/lib/baseline';

test('campaign and endless start states match the recorded baseline', () => {
  const golden = JSON.parse(readFileSync('tests/fixtures/baseline.json', 'utf8'));
  const now = JSON.parse(JSON.stringify(buildBaseline()));
  assert.deepEqual(now.campaign, golden.campaign);
  assert.deepEqual(now.endless, golden.endless);
  assert.deepEqual(now.graceMs, golden.graceMs);
});

test('wave scoring matches the recorded baseline', () => {
  const golden = JSON.parse(readFileSync('tests/fixtures/baseline.json', 'utf8'));
  const now = JSON.parse(JSON.stringify(buildBaseline()));
  assert.deepEqual(now.scoring, golden.scoring);
});
