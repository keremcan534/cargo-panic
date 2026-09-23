/**
 * The resumable game (src/app/activePlay.ts) against a real ProgressManager
 * on an in-memory store: the run and the shipment are saved together, an
 * Endless wave's reward and the next wave are one write, and a saved game
 * comes back paused - or is refused with a reason.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { activeFrom, bankWave, newShipment, resumeActive } from '../../src/app/activePlay';
import type { Shipment } from '../../src/app/activePlay';
import { getWave } from '../../src/game/levels/generator';
import { SAVE_KEYS } from '../../src/game/save/SaveStore';
import type { ActivePlay, SaveData } from '../../src/game/save/schema';
import { nextWave, rewardWave, waveRewardId } from '../../src/game/session';
import type { ShipmentOutcome } from '../../src/game/session';
import { Progress } from '../../src/game/systems/ProgressManager';
import { newRun } from '../../src/game/systems/RunManager';
import { MemoryStore } from '../../src/platform/storage';

/** Keeps every save written to the main key; writes can be made to fail. */
class Recording extends MemoryStore {
  mains: SaveData[] = [];
  failWrites = false;
  override set(key: string, value: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    super.set(key, value);
    if (key === SAVE_KEYS.main) this.mains.push((JSON.parse(value) as { data: SaveData }).data);
  }
}

const settle = () => Promise.resolve();

/** Plays the wave's proved solution and lets it settle into a win. */
function winShipment(sh: Shipment): ShipmentOutcome {
  const plan = getWave(sh.run!.seed, sh.run!.wave);
  for (const p of plan.solution) assert.equal(sh.session.move(p.id, p.shelf, p.slot).ok, true);
  let out = sh.session.advance(0);
  for (let i = 0; i < 100 && !out.outcome; i++) out = sh.session.advance(50);
  assert.equal(out.outcome?.result, 'won');
  return out.outcome!;
}

function sansPhase<T extends { phase: unknown }>(s: T) {
  const { phase: _phase, ...rest } = s;
  return rest;
}

describe('activeFrom', () => {
  test('a campaign shipment round-trips through the save and comes back paused and identical', async () => {
    const mem = new Recording();
    const p = new Progress(mem);
    const sh = newShipment({ levelId: 4 });
    assert.equal(sh.session.move(0, 0, 2).ok, true);
    assert.equal(sh.session.move(1, 0, 4).ok, true); // tips the rack: a hazard clock runs
    sh.session.advance(700);
    assert.equal(sh.session.hazard.kind, 'balance');
    const before = sh.session.snapshot();
    p.setActive(activeFrom(sh.session, null));
    await settle();

    const reloaded = new Progress(mem);
    assert.deepEqual(reloaded.takeSaveNotices(), []);
    const r = resumeActive(reloaded.active!);
    assert.ok(r.ok);
    const after = r.shipment.session.snapshot();
    assert.equal(after.phase, 'paused');
    assert.deepEqual(sansPhase(after), sansPhase(before));
    assert.equal(r.shipment.restored, true);
    assert.equal(r.shipment.run, null);
  });

  test('an Endless run and its shipment are captured together, as copies', async () => {
    const mem = new Recording();
    const p = new Progress(mem);
    const run = newRun(12345);
    const sh = newShipment({ run });
    const plan = getWave(12345, 1);
    const first = plan.solution[0];
    sh.session.move(first.id, first.shelf, first.slot);
    const a = activeFrom(sh.session, run) as Extract<ActivePlay, { kind: 'endless' }>;
    run.score = 999;
    assert.equal(a.run.score, 0, 'a copy of the run, not the live object');
    assert.deepEqual(a.shipment?.source, { mode: 'endless', runId: run.runId, seed: 12345, wave: 1 });
    p.setActive(a);
    await settle();
    const reloaded = new Progress(mem);
    assert.deepEqual(reloaded.takeSaveNotices(), [], 'the save keeps the pair (no active-dropped)');
    assert.equal(reloaded.active?.kind, 'endless');
  });

  test("never pairs the next wave with the old wave's shipment; a finished shipment is not resumable", () => {
    const run = newRun(12345);
    const sh = newShipment({ run });
    const outcome = winShipment(sh);
    assert.equal(activeFrom(sh.session, run), null, 'a finished current wave');
    rewardWave(run, sh.level, outcome);
    nextWave(run);
    const a = activeFrom(sh.session, run) as Extract<ActivePlay, { kind: 'endless' }>;
    assert.equal(a.run.wave, 2);
    assert.equal(a.shipment, null);

    const lvl = newShipment({ levelId: 1 });
    lvl.session.move(0, 0, 1);
    lvl.session.move(1, 0, 3);
    let out = lvl.session.advance(0);
    for (let i = 0; i < 100 && !out.outcome; i++) out = lvl.session.advance(50);
    assert.equal(out.outcome?.result, 'won');
    assert.equal(activeFrom(lvl.session, null), null);
  });
});

describe('bankWave', () => {
  /** A run on wave 1 saved as active, then played to a win. */
  async function wonWave(mem: Recording) {
    const p = new Progress(mem);
    const run = newRun(12345);
    const sh = newShipment({ run });
    p.setActive(activeFrom(sh.session, run));
    await settle();
    const outcome = winShipment(sh);
    return { p, run, sh, outcome, id: waveRewardId(run), stale: { ...run } };
  }

  test('reward, next wave and active are one write: every saved state has all of them or none', async () => {
    const mem = new Recording();
    const { p, run, sh, outcome, id } = await wonWave(mem);
    const writesBefore = mem.mains.length;
    const bank = bankWave(p, run, sh.level, outcome);
    await settle();
    assert.ok(bank?.paid);
    assert.equal(bank.wave, 1);
    assert.ok(bank.result.total > 0);
    assert.equal(run.wave, 2);
    assert.equal(run.score, bank.result.total);
    assert.equal(mem.mains.length, writesBefore + 1, 'the claim is a single write');

    for (const d of mem.mains) {
      const a = d.active as Extract<ActivePlay, { kind: 'endless' }>;
      if (d.claimed.includes(id)) {
        assert.deepEqual(
          { wave: a.run.wave, rewardedThrough: a.run.rewardedThrough, score: a.run.score, shipment: a.shipment },
          { wave: 2, rewardedThrough: 1, score: bank.result.total, shipment: null },
        );
      } else {
        assert.deepEqual({ wave: a.run.wave, score: a.run.score }, { wave: 1, score: 0 });
      }
    }
    assert.ok(mem.mains[mem.mains.length - 1].claimed.includes(id));
  });

  test('a write that dies during the claim leaves the save with neither the reward nor the next wave', async () => {
    const mem = new Recording();
    const { p, run, sh, outcome, id } = await wonWave(mem);
    mem.failWrites = true; // the "crash": nothing of the claim reaches storage
    bankWave(p, run, sh.level, outcome);
    mem.failWrites = false;
    const reloaded = new Progress(mem);
    const a = reloaded.active as Extract<ActivePlay, { kind: 'endless' }>;
    assert.equal(reloaded.hasClaimed(id), false);
    assert.deepEqual({ wave: a.run.wave, score: a.run.score, rewardedThrough: a.run.rewardedThrough }, {
      wave: 1,
      score: 0,
      rewardedThrough: 0,
    });
    assert.notEqual(a.shipment, null, 'still the unfinished wave 1');
  });

  test('never pays twice: the same outcome again, or an older copy of the run after a reload', async () => {
    const mem = new Recording();
    const { p, run, sh, outcome, stale } = await wonWave(mem);
    const bank = bankWave(p, run, sh.level, outcome)!;
    const score = run.score;
    assert.equal(bankWave(p, run, sh.level, outcome), null, 'a repeated outcome changes nothing');
    assert.equal(run.score, score);
    assert.equal(run.wave, 2);

    await settle();
    const reloaded = new Progress(mem);
    const again = bankWave(reloaded, stale, sh.level, outcome);
    assert.equal(again?.paid, false);
    assert.equal(stale.score, bank.result.total, 'caught up with the saved run, not paid again');
    assert.equal(stale.wave, 2);
    const a = reloaded.active as Extract<ActivePlay, { kind: 'endless' }>;
    assert.equal(a.run.score, bank.result.total);
  });
});

describe('resumeActive', () => {
  test('an Endless active between waves deals run.wave paused; its clocks wait for RESUME', () => {
    const run = { ...newRun(12345), wave: 3, score: 1200, rewardedThrough: 2 };
    const r = resumeActive({ kind: 'endless', rulesetVersion: 2, generatorVersion: 1, run, shipment: null });
    assert.ok(r.ok);
    const s = r.shipment.session;
    assert.equal(r.shipment.restored, false);
    assert.deepEqual(s.source, { mode: 'endless', runId: run.runId, seed: 12345, wave: 3 });
    assert.equal(s.phase, 'paused');
    assert.deepEqual(s.placements, []);
    assert.equal(s.queue.length, getWave(12345, 3).level.packages.length);
    assert.equal(s.undoLeft, 1);
    assert.equal(r.shipment.run?.score, 1200);
    s.advance(250);
    assert.equal(s.activeMs, 0, 'paused: no time charged');
    assert.equal(s.resume(), true);
    s.advance(250);
    assert.equal(s.activeMs, 250);
  });

  test('an undo used before the reload stays used after it', () => {
    const sh = newShipment({ levelId: 2 });
    sh.session.move(0, 0, 0);
    assert.equal(sh.session.undo(), true);
    sh.session.move(0, 0, 1);
    const r = resumeActive(activeFrom(sh.session, null)!);
    assert.ok(r.ok);
    const s = r.shipment.session;
    s.resume();
    assert.equal(s.undoLeft, 0);
    assert.equal(s.canUndo, false);
    assert.equal(s.assists.undos, 1);
  });

  test('a save it cannot rebuild exactly is refused with a reason, never half-restored', () => {
    const sh = newShipment({ levelId: 4 });
    sh.session.move(0, 0, 2);
    const good = activeFrom(sh.session, null) as Extract<ActivePlay, { kind: 'campaign' }>;
    const tweak = (edit: (a: Extract<ActivePlay, { kind: 'campaign' }>) => void) => {
      const a = JSON.parse(JSON.stringify(good)) as Extract<ActivePlay, { kind: 'campaign' }>;
      edit(a);
      return resumeActive(a);
    };
    assert.deepEqual(tweak((a) => (a.rulesetVersion = 1)), { ok: false, reason: 'unsupported' });
    assert.deepEqual(tweak((a) => (a.shipment.levelFingerprint = 'x')), { ok: false, reason: 'level-changed' });
    assert.deepEqual(tweak((a) => (a.levelId = 99)), { ok: false, reason: 'corrupt' });
    assert.deepEqual(tweak((a) => (a.shipment.queue = [])), { ok: false, reason: 'corrupt' });

    const run = { ...newRun(12345), wave: 2, rewardedThrough: 1 };
    const endless = (edit: Partial<Extract<ActivePlay, { kind: 'endless' }>>) =>
      resumeActive({ kind: 'endless', rulesetVersion: 2, generatorVersion: 1, run, shipment: null, ...edit });
    assert.deepEqual(endless({ generatorVersion: 99 }), { ok: false, reason: 'unsupported' });
    assert.deepEqual(endless({ run: { ...run, rewardedThrough: 2 } }), { ok: false, reason: 'corrupt' });
    assert.equal(endless({}).ok, true);

    // A finished shipment is never a game in progress.
    const done = newShipment({ run: newRun(12345) });
    winShipment(done);
    const finished = {
      kind: 'endless' as const,
      rulesetVersion: 2,
      generatorVersion: 1,
      run: done.run!,
      shipment: done.session.snapshot(),
    };
    assert.deepEqual(resumeActive(finished), { ok: false, reason: 'corrupt' });
  });
});
