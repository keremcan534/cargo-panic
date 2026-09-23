/**
 * ProgressManager on an in-memory store: the records that end a game end
 * the resumable game in the same write.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLevel } from '../../src/game/levels/levels';
import { SAVE_KEYS } from '../../src/game/save/SaveStore';
import type { ActivePlay, SaveData } from '../../src/game/save/schema';
import { GameSession, RULESET_VERSION } from '../../src/game/session';
import { Progress } from '../../src/game/systems/ProgressManager';
import { MemoryStore } from '../../src/platform/storage';

/** A store that keeps every payload written to the main key. */
class Recording extends MemoryStore {
  mains: SaveData[] = [];
  override set(key: string, value: string) {
    super.set(key, value);
    if (key === SAVE_KEYS.main) this.mains.push((JSON.parse(value) as { data: SaveData }).data);
  }
}

const last = (mem: Recording): SaveData | undefined => mem.mains[mem.mains.length - 1];

function campaignActive(levelId: number): Extract<ActivePlay, { kind: 'campaign' }> {
  const s = new GameSession(getLevel(levelId), { source: { mode: 'campaign', levelId }, undoAllowance: 1 });
  s.move(0, 0, 1);
  return { kind: 'campaign', levelId, rulesetVersion: RULESET_VERSION, shipment: s.snapshot() };
}

test('a campaign win records the stars and clears the active game in one write', async () => {
  const mem = new Recording();
  const p = new Progress(mem);
  p.setActive(campaignActive(2));
  await Promise.resolve();
  assert.equal(last(mem)?.active?.kind, 'campaign');
  const before = mem.mains.length;
  p.recordWin(2, 3, 0.5);
  await Promise.resolve();
  assert.equal(mem.mains.length, before + 1, 'one write');
  const written = last(mem)!;
  assert.equal(written.campaign.stars[2], 3);
  assert.equal(written.active, null);
});

test('a finished Endless run records it and clears the active run in one write', async () => {
  const mem = new Recording();
  const p = new Progress(mem);
  p.setActive({
    kind: 'endless',
    rulesetVersion: RULESET_VERSION,
    generatorVersion: 1,
    run: { runId: 'r', seed: 7, wave: 3, score: 500, stowed: 9, cleanWaves: 0, assisted: false, rewardedThrough: 2 },
    shipment: null,
  });
  await Promise.resolve();
  const before = mem.mains.length;
  p.recordRun(500, 3);
  await Promise.resolve();
  assert.equal(mem.mains.length, before + 1, 'one write');
  const written = last(mem)!;
  assert.equal(written.endless[String(RULESET_VERSION)].bestScore, 500);
  assert.equal(written.active, null);
});

test("setActive stores a copy: later changes to the caller's object are not saved", async () => {
  const mem = new Recording();
  const p = new Progress(mem);
  const a = campaignActive(1);
  p.setActive(a);
  a.shipment.placements.length = 0;
  await Promise.resolve();
  const saved = last(mem)!.active as Extract<ActivePlay, { kind: 'campaign' }>;
  assert.equal(saved.shipment.placements.length, 1);
});
