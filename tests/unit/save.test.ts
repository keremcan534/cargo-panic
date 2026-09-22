/**
 * Save v2: migration from v1, backup recovery, loud failure, single-claim
 * rewards and coalesced writes. Runs against an in-memory store.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SAVE_KEYS, SaveStore } from '../../src/game/save/SaveStore';
import type { SaveNotice } from '../../src/game/save/SaveStore';
import { MemoryStore } from '../../src/platform/storage';

const LEVELS = 25;

/** A store whose writes can be made to fail and are counted. */
class FlakyStore extends MemoryStore {
  failWrites = false;
  writes: string[] = [];
  override set(key: string, value: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.writes.push(key);
    super.set(key, value);
  }
}

const V1_FULL = {
  unlocked: 9,
  stars: { 1: 3, 2: 3, 3: 2, 4: 1, 8: 3 },
  bestBalance: { 1: 0, 2: 0.5, 3: 1.25, 8: 0 },
  sound: false,
  haptics: false,
  endless: { bestScore: 12480, bestWave: 17, runs: 6 },
};

function open(store: MemoryStore | null) {
  const s = new SaveStore(store, LEVELS);
  const source = s.load();
  return { s, source, notices: s.takeNotices() };
}

describe('v1 migration', () => {
  test('keeps every v1 gain and leaves the v1 key untouched', () => {
    const mem = new MemoryStore();
    const raw = JSON.stringify(V1_FULL);
    mem.set(SAVE_KEYS.v1, raw);
    const { s, source, notices } = open(mem);
    assert.equal(source, 'migrated-v1');
    assert.deepEqual(notices, []);
    assert.equal(s.data.campaign.unlocked, 9);
    assert.deepEqual(s.data.campaign.stars, V1_FULL.stars);
    assert.deepEqual(s.data.campaign.bestBalance, V1_FULL.bestBalance);
    assert.equal(s.data.settings.sound, false);
    assert.equal(s.data.settings.haptics, false);
    assert.deepEqual(s.data.endless['1'], V1_FULL.endless);
    assert.equal(mem.get(SAVE_KEYS.v1), raw, 'v1 key untouched');
    assert.equal(mem.get(SAVE_KEYS.v1Backup), raw, 'v1 copied aside');
    assert.ok(mem.get(SAVE_KEYS.main), 'v2 written');
    const again = open(mem);
    assert.equal(again.source, 'v2');
    assert.deepEqual(again.s.data, s.data);
  });

  test('a pre-Endless v1 save migrates with no Endless record', () => {
    const mem = new MemoryStore();
    mem.set(SAVE_KEYS.v1, JSON.stringify({ unlocked: 3, stars: { 1: 2, 2: 3 }, bestBalance: {}, sound: true, haptics: true }));
    const { s } = open(mem);
    assert.equal(s.data.campaign.unlocked, 3);
    assert.deepEqual(s.data.endless, {});
  });

  test('an unreadable v1 is quarantined and reported, never silently reset', () => {
    const mem = new MemoryStore();
    mem.set(SAVE_KEYS.v1, '{"unlocked": 4, "sta');
    const { source, notices } = open(mem);
    assert.equal(source, 'unreadable');
    assert.deepEqual(notices, ['unreadable']);
    assert.equal(mem.get(SAVE_KEYS.corrupt), '{"unlocked": 4, "sta');
    assert.equal(mem.get(SAVE_KEYS.v1), '{"unlocked": 4, "sta', 'original left in place');
  });
});

describe('v2 durability', () => {
  test('round-trips settings, progress and records', () => {
    const mem = new MemoryStore();
    const { s } = open(mem);
    s.update((d) => {
      d.settings.renderMode = '2d';
      d.settings.quality = 'low';
      d.settings.language = 'tr';
      d.campaign.stars[5] = 3;
      d.endless['2'] = { bestScore: 900, bestWave: 4, runs: 1 };
    });
    s.flush();
    const { s: r, source } = open(mem);
    assert.equal(source, 'v2');
    assert.equal(r.data.settings.renderMode, '2d');
    assert.equal(r.data.settings.language, 'tr');
    assert.equal(r.data.campaign.stars[5], 3);
    assert.deepEqual(r.data.endless['2'], { bestScore: 900, bestWave: 4, runs: 1 });
  });

  test('every write rotates the previous good save into the backup', () => {
    const mem = new MemoryStore();
    const { s } = open(mem);
    s.update((d) => (d.campaign.unlocked = 2));
    s.flush();
    const first = mem.get(SAVE_KEYS.main);
    s.update((d) => (d.campaign.unlocked = 3));
    s.flush();
    assert.equal(mem.get(SAVE_KEYS.backup), first);
  });

  test('a truncated main save is recovered from the backup, loudly', () => {
    const mem = new MemoryStore();
    const { s } = open(mem);
    s.update((d) => (d.campaign.unlocked = 6));
    s.flush();
    s.update((d) => (d.campaign.unlocked = 7));
    s.flush();
    const good = mem.get(SAVE_KEYS.main) as string;
    mem.set(SAVE_KEYS.main, good.slice(0, good.length - 20));
    const { s: r, source, notices } = open(mem);
    assert.equal(source, 'recovered-backup');
    assert.deepEqual(notices, ['recovered-backup']);
    assert.equal(r.data.campaign.unlocked, 6);
    assert.equal(mem.get(SAVE_KEYS.corrupt), good.slice(0, good.length - 20));
    assert.equal(open(mem).source, 'v2', 'main key rewritten with the recovered save');
  });

  test('a checksum mismatch (partial or edited payload) counts as corrupt', () => {
    const mem = new MemoryStore();
    const { s } = open(mem);
    s.update((d) => (d.campaign.unlocked = 5));
    s.flush();
    s.update((d) => (d.campaign.unlocked = 6));
    s.flush();
    mem.set(SAVE_KEYS.main, (mem.get(SAVE_KEYS.main) as string).replace('"unlocked":6', '"unlocked":25'));
    const { s: r, source } = open(mem);
    assert.equal(source, 'recovered-backup');
    assert.equal(r.data.campaign.unlocked, 5);
  });

  test('corrupt main and backup fall back to the legacy v1 save if present', () => {
    const mem = new MemoryStore();
    mem.set(SAVE_KEYS.v1, JSON.stringify(V1_FULL));
    mem.set(SAVE_KEYS.main, '###');
    mem.set(SAVE_KEYS.backup, '{"v":2}');
    const { s, source, notices } = open(mem);
    assert.equal(source, 'recovered-v1');
    assert.deepEqual(notices, ['recovered-v1']);
    assert.equal(s.data.campaign.unlocked, 9);
  });

  test('nothing recoverable: reported as unreadable and the bad data is kept aside', () => {
    const mem = new MemoryStore();
    mem.set(SAVE_KEYS.main, 'not json');
    const { source, notices } = open(mem);
    assert.equal(source, 'unreadable');
    assert.deepEqual(notices, ['unreadable']);
    assert.equal(mem.get(SAVE_KEYS.corrupt), 'not json');
  });

  test('a save from a newer build is never overwritten', () => {
    const mem = new MemoryStore();
    const future = JSON.stringify({ v: 3, sum: 'x', data: { anything: true } });
    mem.set(SAVE_KEYS.main, future);
    const { s, source, notices } = open(mem);
    assert.equal(source, 'newer-version');
    assert.deepEqual(notices, ['newer-version']);
    s.update((d) => (d.campaign.unlocked = 4));
    assert.equal(s.flush(), false);
    assert.equal(mem.get(SAVE_KEYS.main), future);
    assert.equal(s.status.persistent, false);
  });

  test('an unusable active run is dropped with a notice; progress survives', () => {
    const mem = new MemoryStore();
    const { s } = open(mem);
    s.update((d) => {
      d.campaign.unlocked = 8;
      (d as unknown as { active: unknown }).active = { kind: 'endless', run: { nope: 1 } };
    });
    s.flush();
    const { s: r, notices } = open(mem);
    assert.deepEqual(notices, ['active-dropped']);
    assert.equal(r.data.active, null);
    assert.equal(r.data.campaign.unlocked, 8);
  });
});

describe('failure is loud', () => {
  test('a failing write raises write-failed once and keeps data in memory', () => {
    const mem = new FlakyStore();
    const s = new SaveStore(mem, LEVELS);
    s.load();
    const seen: SaveNotice[] = [];
    s.onNotice((n) => seen.push(n));
    mem.failWrites = true;
    s.update((d) => (d.campaign.unlocked = 4));
    assert.equal(s.flush(), false);
    s.update((d) => (d.campaign.unlocked = 5));
    s.flush();
    assert.deepEqual(seen, ['write-failed']);
    assert.equal(s.status.writeFailed, true);
    assert.equal(s.data.campaign.unlocked, 5);
    mem.failWrites = false;
    assert.equal(s.flush(), true);
    assert.equal(s.status.writeFailed, false);
  });

  test('no storage at all is reported, and play continues from memory', () => {
    const { s, source, notices } = open(null);
    assert.equal(source, 'no-storage');
    assert.deepEqual(notices, ['no-storage']);
    s.update((d) => (d.campaign.unlocked = 3));
    assert.equal(s.data.campaign.unlocked, 3);
  });
});

describe('rewards and write coalescing', () => {
  test('a reward id is granted once, across reloads', () => {
    const mem = new MemoryStore();
    const { s } = open(mem);
    const grant = (d: { campaign: { unlocked: number } }) => d.campaign.unlocked++;
    assert.equal(s.claim('endless:run-a:w1', grant), true);
    assert.equal(s.claim('endless:run-a:w1', grant), false);
    assert.equal(s.data.campaign.unlocked, 2);
    const { s: r } = open(mem);
    assert.equal(r.claim('endless:run-a:w1', grant), false);
    assert.equal(r.data.campaign.unlocked, 2);
  });

  test('several updates in one task become one write', async () => {
    const mem = new FlakyStore();
    const s = new SaveStore(mem, LEVELS);
    s.load();
    mem.writes = [];
    s.update((d) => (d.campaign.unlocked = 2));
    s.update((d) => (d.campaign.unlocked = 3));
    s.update((d) => (d.settings.sound = false));
    assert.equal(mem.writes.length, 0, 'nothing written synchronously per update');
    await Promise.resolve();
    assert.deepEqual(mem.writes, [SAVE_KEYS.main]);
    const { s: r } = open(mem);
    assert.equal(r.data.campaign.unlocked, 3);
    assert.equal(r.data.settings.sound, false);
  });
});

describe('active play consistency', () => {
  const shipment = (source: object) => ({
    v: 1,
    ruleset: 2,
    generator: 1,
    source,
    levelFingerprint: 'x',
    graceScale: 1,
    phase: 'paused',
    placements: [],
    queue: [0],
    hazards: { balance: 3000, overload: [], fragile: [] },
    winSettleMs: 0,
    activeMs: 0,
    dangerMs: 0,
    assists: { hints: 0, undos: 0 },
    rejectedDrops: 0,
    undoLeft: 1,
    undo: null,
    outcome: null,
  });
  const run = { runId: 'r1', seed: 42, wave: 3, score: 900, stowed: 12, cleanWaves: 1, assisted: false, rewardedThrough: 2 };

  test('an Endless run and shipment that describe different waves are dropped, loudly', () => {
    const mem = new MemoryStore();
    const { s } = open(mem);
    s.update((d) => {
      (d as unknown as { active: unknown }).active = {
        kind: 'endless',
        rulesetVersion: 2,
        generatorVersion: 1,
        run: { ...run, wave: 4, rewardedThrough: 3 },
        shipment: shipment({ mode: 'endless', runId: 'r1', seed: 42, wave: 3 }),
      };
    });
    s.flush();
    const { s: r, notices } = open(mem);
    assert.deepEqual(notices, ['active-dropped']);
    assert.equal(r.data.active, null);
  });

  test('a matching run and shipment survive a reload', () => {
    const mem = new MemoryStore();
    const { s } = open(mem);
    s.update((d) => {
      (d as unknown as { active: unknown }).active = {
        kind: 'endless',
        rulesetVersion: 2,
        generatorVersion: 1,
        run,
        shipment: shipment({ mode: 'endless', runId: 'r1', seed: 42, wave: 3 }),
      };
    });
    s.flush();
    const { s: r, notices } = open(mem);
    assert.deepEqual(notices, []);
    assert.equal(r.data.active?.kind, 'endless');
  });
});
