/**
 * The pure shipment session: commands, clocks and snapshots.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GRACE_MS, WIN_SETTLE_MS } from '../../src/game/config';
import { getLevel } from '../../src/game/levels/levels';
import type { LevelDef } from '../../src/game/levels/types';
import { GameSession, SessionRestoreError } from '../../src/game/session';
import type { ShipmentSnapshot } from '../../src/game/session';

/** One 5-slot shelf, generous capacity; a heavy crate at the edge tips it. */
const TIP: LevelDef = {
  id: 900,
  name: 'TEST TIP',
  objective: '',
  shelves: [{ slots: 5, maxWeight: 20 }],
  packages: ['heavy', 'standard', 'standard'],
  balanceTolerance: 4,
};

/** Two shelves; the top one is rated for 4, so a heavy crate overloads it. */
const LOAD: LevelDef = {
  id: 901,
  name: 'TEST LOAD',
  objective: '',
  shelves: [
    { slots: 5, maxWeight: 20 },
    { slots: 5, maxWeight: 4 },
  ],
  packages: ['heavy', 'fragile', 'standard'],
  balanceTolerance: 20,
};

const campaign = (level: LevelDef) => new GameSession(level, { source: { mode: 'campaign', levelId: level.id } });

function run(level: LevelDef, script: (s: GameSession) => void) {
  const s = campaign(level);
  script(s);
  return s;
}

function tickFor(s: GameSession, ms: number, step = 16) {
  let out = s.tick(0);
  for (let t = 0; t < ms; t += step) {
    out = s.tick(step);
    if (out.outcome) break;
  }
  return out;
}

describe('commands', () => {
  test('a belt package moves to a shelf atomically', () => {
    const s = campaign(TIP);
    const r = s.move(0, 0, 2);
    assert.deepEqual(r, { ok: true, changed: true, from: { at: 'belt', index: 0 } });
    assert.deepEqual(s.queue, [1, 2]);
    assert.deepEqual(s.placements, [{ id: 0, type: 'heavy', shelf: 0, slot: 2 }]);
  });

  test('only the live belt package and stowed packages are movable', () => {
    const s = campaign(TIP);
    assert.deepEqual(s.movable(), [0]);
    assert.deepEqual(s.move(1, 0, 0), { ok: false, rejection: 'not-movable' });
    s.move(0, 0, 2);
    assert.deepEqual(s.movable().sort(), [0, 1]);
  });

  test('an invalid target changes neither the board nor the belt', () => {
    const s = campaign(TIP);
    s.move(0, 0, 2);
    const before = JSON.stringify([s.placements, s.queue, s.evaluation]);
    assert.deepEqual(s.move(1, 0, 2), { ok: false, rejection: 'occupied' });
    assert.deepEqual(s.move(1, 0, 9), { ok: false, rejection: 'out-of-bounds' });
    assert.deepEqual(s.move(1, 3, 0), { ok: false, rejection: 'out-of-bounds' });
    assert.equal(JSON.stringify([s.placements, s.queue, s.evaluation]), before);
    assert.equal(s.rejectedDrops, 3);
  });

  test('dropping a package back where it already is changes nothing', () => {
    const s = campaign(TIP);
    s.move(0, 0, 2);
    const r = s.move(0, 0, 2);
    assert.deepEqual(r, { ok: true, changed: false, from: { at: 'shelf', shelf: 0, slot: 2 } });
    assert.equal(s.rejectedDrops, 0);
  });

  test('a stowed package moves between slots in one command', () => {
    const s = campaign(TIP);
    s.move(0, 0, 2);
    s.move(1, 0, 0);
    assert.equal(s.move(0, 0, 4).ok, true);
    assert.deepEqual(
      s.placements.sort((a, b) => a.id - b.id),
      [
        { id: 0, type: 'heavy', shelf: 0, slot: 4 },
        { id: 1, type: 'standard', shelf: 0, slot: 0 },
      ],
    );
  });

  test('toBelt puts a stowed package back at the front of the belt', () => {
    const s = campaign(TIP);
    s.move(0, 0, 2);
    const r = s.toBelt(0);
    assert.equal(r.ok && r.changed, true);
    assert.deepEqual(s.queue, [0, 1, 2]);
    assert.equal(s.placements.length, 0);
    assert.deepEqual(s.toBelt(0), { ok: true, changed: false, from: { at: 'belt', index: 0 } });
  });

  test('preview reports the hypothetical board without committing it', () => {
    const s = campaign(LOAD);
    const p = s.preview(0, 1, 2);
    assert.equal(p.kind, 'crush');
    assert.equal(p.willOverload, true);
    assert.equal(s.placements.length, 0);
    assert.equal(s.preview(0, 0, 9).kind, 'bad');
  });
});

describe('holding is not a board change', () => {
  test('holding a package leaves the board, belt and evaluation untouched', () => {
    const s = campaign(TIP);
    s.move(0, 0, 4);
    const before = JSON.stringify([s.placements, s.queue, s.evaluation]);
    assert.equal(s.hold(0), true);
    assert.equal(s.held, 0);
    assert.equal(JSON.stringify([s.placements, s.queue, s.evaluation]), before);
    assert.equal(s.hold(1), false, 'only one package can be in hand');
    assert.equal(s.held, 0);
    assert.equal(JSON.stringify([s.placements, s.queue, s.evaluation]), before);
    s.release(1);
    assert.equal(s.held, 0, 'releasing another id does not drop the held package');
    s.release();
    assert.equal(s.held, null);
  });

  test('holding the offending crate does not stop the collapse clock', () => {
    const s = campaign(TIP);
    s.move(0, 0, 4); // heavy on the far right: imbalance 10 > 4
    let out = s.tick(100);
    assert.equal(out.hazard.kind, 'balance');
    const left = out.hazard.remaining;
    s.hold(0);
    out = s.tick(100);
    assert.equal(out.hazard.kind, 'balance');
    assert.ok(out.hazard.remaining < left, 'clock keeps draining while held');
    out = tickFor(s, GRACE_MS.balance * 2);
    assert.equal(out.outcome?.result, 'failed');
    assert.equal(out.outcome?.failure?.kind, 'balance');
  });

  test('a finished board does not settle into a win while something is held', () => {
    const s = campaign(TIP);
    s.move(0, 0, 2);
    s.move(1, 0, 0);
    s.move(2, 0, 4);
    assert.equal(s.canFinish, true);
    s.hold(1);
    tickFor(s, WIN_SETTLE_MS * 3);
    assert.equal(s.phase, 'play');
    s.release();
    const out = tickFor(s, WIN_SETTLE_MS * 2);
    assert.equal(out.outcome?.result, 'won');
  });
});

describe('clocks', () => {
  test('paused: no active time, no hazard drain, no commands', () => {
    const s = campaign(TIP);
    const twin = campaign(TIP);
    for (const x of [s, twin]) {
      x.move(0, 0, 4);
      x.tick(100);
    }
    const active = s.activeMs;
    s.pause();
    s.tick(5000);
    assert.equal(s.activeMs, active);
    assert.equal(s.phase, 'paused');
    assert.deepEqual(s.move(1, 0, 0), { ok: false, rejection: 'not-playing' });
    s.resume();
    // The paused session is exactly where a never-paused twin is.
    assert.equal(s.tick(16).hazard.remaining, twin.tick(16).hazard.remaining);
    assert.equal(s.activeMs, twin.activeMs);
  });

  test('fixing the problem refills the clock', () => {
    const s = campaign(TIP);
    s.move(0, 0, 4);
    tickFor(s, 1000);
    s.move(0, 0, 2);
    const out = s.tick(16);
    assert.equal(out.hazard.kind, null);
  });

  test('overload and fragile failures carry the facts behind them', () => {
    const over = campaign(LOAD);
    over.move(0, 1, 2);
    const o1 = tickFor(over, 10_000);
    assert.deepEqual(o1.outcome?.failure, { kind: 'overload', tier: 1, load: 5, max: 4 });

    const crush: LevelDef = { ...LOAD, shelves: [{ slots: 5, maxWeight: 20 }, { slots: 5, maxWeight: 20 }] };
    const c = campaign(crush);
    c.move(0, 1, 2);
    c.move(1, 0, 2);
    const o2 = tickFor(c, 10_000);
    assert.deepEqual(o2.outcome?.failure, { kind: 'fragile', fragileId: 1, crusherIds: [0] });
  });

  test('terminal sessions ignore further commands', () => {
    const s = campaign(TIP);
    s.move(0, 0, 4);
    tickFor(s, 10_000);
    assert.equal(s.phase, 'failed');
    assert.deepEqual(s.move(1, 0, 0), { ok: false, rejection: 'not-playing' });
    assert.equal(s.pause(), false);
  });
});

describe('determinism', () => {
  const script = (s: GameSession) => {
    s.move(0, 0, 4);
    s.tick(400);
    s.hold(0);
    s.tick(300);
    s.move(0, 0, 2);
    s.move(1, 0, 9);
    s.move(1, 0, 0);
    s.tick(250);
    s.move(2, 0, 4);
    for (let i = 0; i < 60; i++) s.tick(16);
  };

  test('same level + same commands = same board, clocks and outcome', () => {
    const a = run(TIP, script);
    const b = run(TIP, script);
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.equal(a.outcome?.result, 'won');
  });

  test('determinism holds on a real campaign level', () => {
    const lvl = getLevel(8);
    const cmds = (s: GameSession) => {
      for (const id of [...s.queue]) {
        for (let shelf = 0; shelf < lvl.shelves.length; shelf++) {
          let placed = false;
          for (let slot = 0; slot < lvl.shelves[shelf].slots; slot++) {
            if (s.move(id, shelf, slot).ok) {
              placed = true;
              break;
            }
          }
          if (placed) break;
        }
        s.tick(33);
      }
      for (let i = 0; i < 200; i++) s.tick(16);
    };
    assert.deepEqual(run(lvl, cmds).snapshot(), run(lvl, cmds).snapshot());
  });
});

describe('undo', () => {
  test('restores the board, belt and hazard clocks from before the last command', () => {
    const s = new GameSession(TIP, { source: { mode: 'campaign', levelId: 900 }, undoAllowance: 1 });
    s.move(0, 0, 2);
    s.tick(100);
    const before = JSON.stringify([s.placements, s.queue]);
    s.move(1, 0, 4);
    tickFor(s, 500);
    assert.equal(s.undo(), true);
    assert.equal(JSON.stringify([s.placements, s.queue]), before);
    assert.equal(s.hazard.kind, null);
    assert.deepEqual(s.assists, { hints: 0, undos: 1 });
    assert.equal(s.canUndo, false);
    s.move(1, 0, 0);
    assert.equal(s.undo(), false, 'one undo per shipment');
  });

  test('no undo is available by default', () => {
    const s = campaign(TIP);
    s.move(0, 0, 2);
    assert.equal(s.undo(), false);
  });
});

describe('snapshots', () => {
  test('round-trips mid-shipment and comes back paused', () => {
    const s = new GameSession(TIP, { source: { mode: 'campaign', levelId: 900 }, undoAllowance: 1 });
    s.move(0, 0, 4);
    s.tick(700);
    const snap = s.snapshot();
    const r = GameSession.restore(TIP, JSON.parse(JSON.stringify(snap)) as ShipmentSnapshot);
    assert.equal(r.phase, 'paused');
    assert.deepEqual({ ...r.snapshot(), phase: 'play' }, snap);
    r.resume();
    assert.equal(r.tick(16).hazard.remaining, s.tick(16).hazard.remaining);
  });

  test('refuses a snapshot taken on different level data', () => {
    const snap = campaign(TIP).snapshot();
    const changed = { ...TIP, balanceTolerance: 5 };
    assert.throws(() => GameSession.restore(changed, snap), (e: unknown) => {
      return e instanceof SessionRestoreError && e.code === 'level-changed';
    });
  });

  test('refuses an internally inconsistent snapshot', () => {
    const s = campaign(TIP);
    s.move(0, 0, 2);
    const bad = s.snapshot();
    bad.queue = [0, 1, 2];
    assert.throws(() => GameSession.restore(TIP, bad), SessionRestoreError);
    const overlap = s.snapshot();
    overlap.queue = [2];
    overlap.placements.push({ id: 1, type: 'standard', shelf: 0, slot: 2 });
    assert.throws(() => GameSession.restore(TIP, overlap), SessionRestoreError);
  });
});

describe('hint', () => {
  test('counts as an assist only when the solver answers', () => {
    const s = campaign(getLevel(3));
    const h = s.hint();
    assert.ok(h && h.kind !== 'stuck');
    assert.equal(s.assists.hints, 1);
    assert.equal(s.placements.length, 0, 'a hint never moves cargo');
  });
});

describe('review hardening', () => {
  const heldBoard = () => {
    const s = campaign(TIP);
    s.move(0, 0, 2);
    s.move(1, 0, 0);
    s.move(2, 0, 4);
    return s;
  };

  test('a second pointer cannot clear the held package and let the board settle', () => {
    const s = heldBoard();
    s.hold(0);
    assert.equal(s.hold(1), false);
    s.release(1);
    tickFor(s, WIN_SETTLE_MS * 3);
    assert.equal(s.phase, 'play');
  });

  test('toBelt refuses a belt package that is not live', () => {
    const s = campaign(TIP);
    assert.deepEqual(s.toBelt(2), { ok: false, rejection: 'not-movable' });
  });

  test('NaN and fractional targets are refused and not charged as refused drops', () => {
    const s = campaign(TIP);
    assert.equal(s.move(0, 0, Number.NaN).ok, false);
    assert.equal(s.move(0, 0, 1.5).ok, false);
    assert.equal(s.preview(0, 0, Number.NaN).kind, 'bad');
    assert.equal(s.rejectedDrops, 0);
    assert.equal(s.placements.length, 0);
  });

  test('getters hand out copies or frozen data', () => {
    const s = campaign(TIP);
    s.move(0, 0, 2);
    const snap = JSON.stringify(s.snapshot());
    assert.throws(() => {
      (s.placements[0] as { slot: number }).slot = 4;
    });
    assert.throws(() => {
      (s.queue as number[]).length = 0;
    });
    assert.throws(() => {
      (s.evaluation as { net: number }).net = 99;
    });
    assert.throws(() => {
      (s.tick(16).hazard as { kind: string | null }).kind = 'balance';
    });
    s.pause();
    const again = JSON.parse(JSON.stringify(s.snapshot()));
    again.phase = 'play';
    const before = JSON.parse(snap);
    assert.deepEqual(again.placements, before.placements);
    assert.deepEqual(again.queue, before.queue);
  });

  test('preview does not flag a neutral move as crushing while another crate is already crushed', () => {
    const crush: LevelDef = { ...LOAD, packages: ['heavy', 'fragile', 'standard'], shelves: [{ slots: 5, maxWeight: 20 }, { slots: 5, maxWeight: 20 }] };
    const s = campaign(crush);
    s.move(0, 1, 2);
    s.move(1, 0, 2);
    assert.deepEqual(s.evaluation.crushed, [1]);
    assert.equal(s.preview(2, 0, 0).kind, 'ok');
    assert.equal(s.preview(2, 0, 0).willCrush, false);
  });

  test('the hazard read-out survives pause, restore and undo', () => {
    const s = new GameSession(TIP, { source: { mode: 'campaign', levelId: 900 }, undoAllowance: 1 });
    s.move(0, 0, 4);
    tickFor(s, 400);
    const left = s.hazard.remaining;
    assert.equal(s.hazard.kind, 'balance');
    s.pause();
    const paused = s.tick(16);
    assert.equal(paused.hazard.kind, 'balance', 'paused shows the frozen countdown');
    assert.equal(paused.hazard.remaining, left);
    const r = GameSession.restore(TIP, s.snapshot());
    assert.equal(r.hazard.kind, 'balance');
    assert.equal(r.hazard.remaining, left);
    s.resume();
    s.move(0, 0, 2);
    assert.equal(s.hazard.kind, null, 'a fixing move clears the read-out immediately');
  });

  test('undo does not refund a danger that ran across the undone command', () => {
    const s = new GameSession(TIP, { source: { mode: 'campaign', levelId: 900 }, undoAllowance: 1 });
    s.move(0, 0, 4); // red
    tickFor(s, 400);
    s.move(1, 0, 3); // still red (harmless move)
    tickFor(s, 600);
    const late = s.hazard.remaining;
    s.undo();
    assert.equal(s.hazard.kind, 'balance');
    assert.ok(s.hazard.remaining <= late + 1e-9, `undo refunded ${s.hazard.remaining - late} ms`);
  });

  test('a single call never charges more than one step; advance sub-steps real time', () => {
    const a = campaign(TIP);
    a.move(0, 0, 4);
    a.tick(Number.POSITIVE_INFINITY);
    a.tick(1e6);
    assert.equal(a.activeMs, 50);
    const b = campaign(TIP);
    const c = campaign(TIP);
    b.move(0, 0, 4);
    c.move(0, 0, 4);
    for (let i = 0; i < 10; i++) b.advance(100); // 10 fps
    for (let i = 0; i < 60; i++) c.tick(1000 / 60);
    assert.ok(Math.abs(b.activeMs - 1000) < 1e-6);
    assert.ok(Math.abs(b.hazard.remaining - c.hazard.remaining) < 1e-6, 'slow frames buy no time');
    const d = campaign(TIP);
    d.advance(60_000);
    assert.equal(d.activeMs, 250, 'stalls are capped, not charged');
  });
});

describe('restore validation', () => {
  const base = () => {
    const s = new GameSession(TIP, { source: { mode: 'campaign', levelId: 900 }, undoAllowance: 1 });
    s.move(0, 0, 4);
    s.tick(300);
    s.move(1, 0, 0);
    return s.snapshot();
  };
  const refuses = (mutate: (x: Record<string, unknown>) => void, code = 'corrupt') => {
    const snap = JSON.parse(JSON.stringify(base()));
    mutate(snap);
    assert.throws(
      () => GameSession.restore(TIP, snap),
      (e: unknown) => e instanceof SessionRestoreError && e.code === code,
    );
  };

  test('only SessionRestoreError ever escapes', () => {
    refuses((x) => delete x.queue);
    refuses((x) => (x.hazards = null));
    refuses((x) => ((x.hazards as { overload: unknown }).overload = 'xx'));
    refuses((x) => (x.placements = null));
    refuses((x) => ((x.undo as { hazards: unknown }).hazards = null));
  });

  test('refuses states that would soft-lock or cheat the shipment', () => {
    refuses((x) => (x.phase = 'resolving'));
    refuses((x) => (x.phase = 'won'));
    refuses((x) => (x.assists = { hints: Number.NaN, undos: 0 }));
    refuses((x) => delete x.assists);
    refuses((x) => (x.graceScale = 'x'));
    refuses((x) => (x.undoLeft = -1));
    refuses((x) => (x.activeMs = null));
    refuses((x) => ((x.placements as { slot: unknown }[])[0].slot = null));
    refuses((x) => ((x.undo as { placements: unknown[]; queue: unknown[] }).queue = [2, 2]));
    refuses((x) => {
      const u = x.undo as { placements: { id: number; type: string; shelf: number; slot: number }[]; queue: number[] };
      u.placements = [
        { id: 0, type: 'heavy', shelf: 0, slot: 4 },
        { id: 0, type: 'heavy', shelf: 0, slot: 1 },
      ];
      u.queue = [2];
    });
  });

  test('refuses another snapshot format, ruleset or generator', () => {
    refuses((x) => (x.v = 2), 'unsupported');
    refuses((x) => (x.ruleset = 999), 'unsupported');
  });

  test('clamps restored clocks to a full grace period', () => {
    const snap = JSON.parse(JSON.stringify(base()));
    snap.hazards.balance = 1e9;
    const r = GameSession.restore(TIP, snap);
    r.resume();
    assert.ok(r.tick(16).hazard.remaining <= GRACE_MS.balance);
  });
});

describe('nothing changes under a held package', () => {
  test('other packages cannot be moved, and undo/hint wait, while one is held', () => {
    const s = new GameSession(TIP, { source: { mode: 'campaign', levelId: 900 }, undoAllowance: 1 });
    s.move(0, 0, 2);
    s.move(1, 0, 0);
    s.hold(0);
    assert.deepEqual(s.move(2, 0, 4), { ok: false, rejection: 'not-movable' });
    assert.deepEqual(s.toBelt(1), { ok: false, rejection: 'not-movable' });
    assert.equal(s.canUndo, false);
    assert.equal(s.undo(), false);
    assert.equal(s.hint(), null);
    assert.equal(s.rejectedDrops, 0);
    s.release();
    assert.equal(s.canUndo, true);
  });

  test('a session can start paused and revision tracks persistable changes', () => {
    const s = new GameSession(TIP, { source: { mode: 'campaign', levelId: 900 }, startPaused: true });
    assert.equal(s.phase, 'paused');
    assert.equal(s.tick(1000).hazard.kind, null);
    assert.equal(s.activeMs, 0);
    const r0 = s.revision;
    s.resume();
    s.move(0, 0, 2);
    s.hold(1);
    s.release();
    s.move(1, 0, 9); // refused: no revision
    const r1 = s.revision;
    assert.equal(r1, r0 + 2, 'resume + one committed move');
    s.hint();
    assert.equal(s.revision, r1 + 1, 'a counted hint must be saved');
  });
});
