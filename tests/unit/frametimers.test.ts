/**
 * Frame-clock delays: they move only with the frame time fed to them, so a
 * hidden app (no frames) never fires one.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameTimers } from '../../src/app/FrameTimers';

test('a delay fires once its frame time has passed, not before, and once', () => {
  const t = new FrameTimers();
  let n = 0;
  t.after(500, () => n++);
  t.update(250);
  t.update(249);
  assert.equal(n, 0);
  t.update(1);
  assert.equal(n, 1);
  t.update(1000);
  assert.equal(n, 1);
  assert.equal(t.pending, 0);
});

test('no frames, no time: nothing fires however long the wall clock runs', () => {
  const t = new FrameTimers();
  let fired = false;
  t.after(10, () => (fired = true));
  t.update(0);
  t.update(Number.NaN);
  t.update(-50);
  assert.equal(fired, false);
  assert.equal(t.pending, 1);
});

test('cancel and clear stop pending delays, also from inside another delay', () => {
  const t = new FrameTimers();
  const seen: string[] = [];
  const cancelB = t.after(100, () => seen.push('b'));
  t.after(50, () => {
    seen.push('a');
    cancelB();
  });
  t.update(200);
  assert.deepEqual(seen, ['a']);

  t.after(10, () => {
    seen.push('c');
    t.clear();
  });
  t.after(10, () => seen.push('d'));
  t.update(20);
  assert.deepEqual(seen, ['a', 'c']);
  assert.equal(t.pending, 0);
});

test('a delay set while delays run waits for the next update', () => {
  const t = new FrameTimers();
  const seen: string[] = [];
  t.after(0, () => {
    seen.push('first');
    t.after(0, () => seen.push('second'));
  });
  t.update(16);
  assert.deepEqual(seen, ['first']);
  t.update(16);
  assert.deepEqual(seen, ['first', 'second']);
});
