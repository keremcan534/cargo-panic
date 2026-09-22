/**
 * The first-session guide's state machine (src/ui/tutorialFlow.ts): one step
 * per level 1-3, shown when needed, gone when done, never repeated, and
 * skipping it changes nothing in the game.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getLevel } from '../../src/game/levels/levels';
import { GameSession } from '../../src/game/session';
import { TutorialFlow, stepForLevel } from '../../src/ui/tutorialFlow';
import type { TutorialStep, TutorialStore } from '../../src/ui/tutorialFlow';

/** An in-memory copy of progress.tutorial, recording every write. */
function store(init: { done?: string[]; skipped?: boolean } = {}) {
  const writes: string[] = [];
  const s: TutorialStore & { done: string[]; skipped: boolean; writes: string[] } = {
    done: [...(init.done ?? [])],
    skipped: init.skipped ?? false,
    writes,
    mark(step: TutorialStep) {
      writes.push(`mark:${step}`);
      if (!s.done.includes(step)) s.done.push(step);
    },
    skip() {
      writes.push('skip');
      s.skipped = true;
    },
  };
  return s;
}

describe('tutorial flow', () => {
  test('levels 1-3 each teach one step; nothing elsewhere or in Endless', () => {
    assert.equal(stepForLevel(1), 'place');
    assert.equal(stepForLevel(2), 'preview');
    assert.equal(stepForLevel(3), 'move');
    assert.equal(stepForLevel(4), null);
    assert.equal(stepForLevel(null), null);
    assert.equal(new TutorialFlow(4, store()).active, false);
  });

  test("level 1 'place': shown from the start, done by the first committed move, never again", () => {
    const st = store();
    const f = new TutorialFlow(1, st);
    assert.equal(f.visible, 'place');
    f.hand(true); // picking up does not finish it
    assert.equal(f.visible, 'place');
    f.moved(false, 1);
    assert.equal(f.visible, null);
    assert.deepEqual(st.writes, ['mark:place']);
    f.moved(false, 2);
    assert.deepEqual(st.writes, ['mark:place'], 'marked once');

    const again = new TutorialFlow(1, st);
    assert.equal(again.active, false, 'a done step is not repeated');
    assert.equal(again.visible, null);
  });

  test("level 2 'preview': appears when a package is first held, done when the hand is empty", () => {
    const st = store();
    const f = new TutorialFlow(2, st);
    assert.equal(f.visible, null, 'nothing until the player picks something up');
    f.hand(false);
    assert.deepEqual(st.writes, []);
    f.hand(true);
    assert.equal(f.visible, 'preview');
    f.hand(true);
    f.hand(false);
    assert.equal(f.visible, null);
    assert.deepEqual(st.writes, ['mark:preview']);
    assert.equal(new TutorialFlow(2, st).active, false);
  });

  test("level 3 'move': appears once something is stowed, done only by moving a stowed package", () => {
    const st = store();
    const f = new TutorialFlow(3, st);
    assert.equal(f.visible, null);
    f.moved(false, 1); // first package stowed
    assert.equal(f.visible, 'move');
    f.moved(false, 2); // another belt package: not the lesson
    assert.equal(f.visible, 'move');
    assert.deepEqual(st.writes, []);
    f.moved(true, 2); // a stowed package moved
    assert.equal(f.visible, null);
    assert.deepEqual(st.writes, ['mark:move']);
  });

  test('a shipment that ends first hides the step without marking it: it comes back next time', () => {
    const st = store();
    const f = new TutorialFlow(3, st);
    f.moved(false, 1);
    f.end();
    assert.equal(f.visible, null);
    assert.deepEqual(st.writes, []);
    assert.equal(new TutorialFlow(3, st).active, true);
  });

  test('SKIP hides every step for good; replay (flags cleared) brings them back', () => {
    const st = store({ done: ['place'] });
    const f = new TutorialFlow(2, st);
    f.hand(true);
    f.skip();
    assert.equal(f.visible, null);
    assert.deepEqual(st.writes, ['skip']);
    for (const id of [1, 2, 3]) assert.equal(new TutorialFlow(id, st).active, false, `level ${id} after skip`);

    // REPLAY TUTORIAL = setTutorialSkipped(false), which also clears done.
    st.skipped = false;
    st.done.length = 0;
    assert.equal(new TutorialFlow(1, st).visible, 'place');
  });

  test('skipping mid-level leaves the game session untouched', () => {
    const level = getLevel(1);
    const session = new GameSession(level, { source: { mode: 'campaign', levelId: 1 }, undoAllowance: 1 });
    session.advance(500);
    const before = JSON.stringify(session.snapshot());
    const f = new TutorialFlow(1, store());
    f.hand(true);
    f.skip();
    assert.equal(JSON.stringify(session.snapshot()), before);
    assert.equal(session.phase, 'play', 'not paused, not ended');
    // And play simply continues.
    assert.equal(session.move(0, 0, 1).ok, true);
  });
});
