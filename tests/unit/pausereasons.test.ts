/**
 * The game controller's pause set on a real GameSession: any reason pauses,
 * only the last one resumes, and a finished shipment is never revived.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PauseReasons } from '../../src/app/PauseReasons';
import { GameSession } from '../../src/game/session';
import { getLevel } from '../../src/game/levels/levels';

const level = getLevel(4);
const fresh = () => new GameSession(level, { source: { mode: 'campaign', levelId: level.id } });

describe('PauseReasons', () => {
  test('RESUME during a pending view switch does not start the clocks', () => {
    const s = fresh();
    const p = new PauseReasons(s);
    p.add('menu'); // pause panel opens
    assert.equal(s.phase, 'paused');
    p.add('switching'); // player picks another view
    p.remove('menu'); // ...and presses RESUME before the switch finished
    assert.equal(s.phase, 'paused');
    const before = s.snapshot().activeMs;
    s.advance(500);
    assert.equal(s.snapshot().activeMs, before, 'no time is charged while any reason holds');
    p.remove('switching');
    assert.equal(s.phase, 'play');
    assert.deepEqual(p.list(), []);
  });

  test('removing a reason that is not held changes nothing', () => {
    const s = fresh();
    const p = new PauseReasons(s);
    p.add('context-lost');
    assert.equal(p.remove('menu'), false);
    assert.equal(s.phase, 'paused');
    assert.equal(p.remove('context-lost'), true);
    assert.equal(s.phase, 'play');
  });

  test('the same reason twice is one reason', () => {
    const s = fresh();
    const p = new PauseReasons(s);
    p.add('hidden');
    p.add('hidden');
    assert.equal(p.size, 1);
    p.remove('hidden');
    assert.equal(s.phase, 'play');
  });

  test('pausing a held package puts nothing on the board and a finished shipment stays finished', () => {
    const s = fresh();
    const p = new PauseReasons(s);
    assert.equal(s.hold(0), true);
    p.add('switching');
    assert.equal(s.held, null, 'pause lets go of the package');
    assert.deepEqual(s.placements, []);
    p.remove('switching');

    // A session that is over is not paused or resumed by reasons.
    const won = new GameSession(getLevel(1), { source: { mode: 'campaign', levelId: 1 } });
    won.move(0, 0, 1);
    won.move(1, 0, 3);
    for (let i = 0; i < 100 && won.phase === 'play'; i++) won.advance(100);
    assert.equal(won.phase, 'won');
    const q = new PauseReasons(won);
    q.add('switching');
    assert.equal(won.phase, 'won');
    q.remove('switching');
    assert.equal(won.phase, 'won');
  });
});
