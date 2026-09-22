/**
 * Ruleset 2 judgement: refused drops are free, hints cap stars, undo only
 * voids the Endless clean bonus.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLevel } from '../../src/game/levels/levels';
import { campaignStars, RULESET_VERSION, shipmentScore } from '../../src/game/session';
import type { ShipmentOutcome } from '../../src/game/session';

const outcome = (over: Partial<ShipmentOutcome> = {}): ShipmentOutcome => ({
  result: 'won',
  source: { mode: 'campaign', levelId: 3 },
  ruleset: RULESET_VERSION,
  placements: [],
  imbalance: 0,
  limit: 5,
  assists: { hints: 0, undos: 0 },
  rejectedDrops: 0,
  dangerMs: 0,
  activeMs: 10_000,
  ...over,
});

test('ruleset is 2', () => {
  assert.equal(RULESET_VERSION, 2);
});

test('refused drops never cost stars', () => {
  assert.equal(campaignStars(outcome({ rejectedDrops: 0 })), 3);
  assert.equal(campaignStars(outcome({ rejectedDrops: 1 })), 3);
  assert.equal(campaignStars(outcome({ rejectedDrops: 12 })), 3);
});

test('stars follow the finish: 3 within 40% of the limit, else 2', () => {
  assert.equal(campaignStars(outcome({ imbalance: 2 })), 3);
  assert.equal(campaignStars(outcome({ imbalance: 2.01 })), 2);
});

test('a hint caps stars at 2; undo does not', () => {
  assert.equal(campaignStars(outcome({ assists: { hints: 1, undos: 0 } })), 2);
  assert.equal(campaignStars(outcome({ assists: { hints: 0, undos: 1 } })), 3);
});

test('Endless clean bonus: void with hint or undo, untouched by refused drops', () => {
  const level = getLevel(3);
  assert.equal(shipmentScore(level, 1, outcome({ rejectedDrops: 5 })).clean, true);
  assert.equal(shipmentScore(level, 1, outcome({ assists: { hints: 1, undos: 0 } })).clean, false);
  assert.equal(shipmentScore(level, 1, outcome({ assists: { hints: 0, undos: 1 } })).clean, false);
  const lines = shipmentScore(level, 1, outcome()).lines.map((l) => l.key);
  assert.deepEqual(lines, ['cargo', 'shipment', 'balance', 'perfect', 'clean']);
});
