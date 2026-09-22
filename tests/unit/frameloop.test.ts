/**
 * The app loop: one requestAnimationFrame chain, capped animation time, and
 * real time for the rules clocks - so a slow renderer never slows a hazard.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameLoop } from '../../src/app/FrameLoop';
import { GRACE_MS } from '../../src/game/config';
import type { LevelDef } from '../../src/game/levels/types';
import { GameSession } from '../../src/game/session';

type Cb = (t: number) => void;
const g = globalThis as unknown as {
  requestAnimationFrame: (cb: Cb) => number;
  cancelAnimationFrame: (h: number) => void;
};

function withFakeRaf(run: (step: (t: number) => void, pending: () => number) => void) {
  let queue: Cb[] = [];
  const prev = { r: g.requestAnimationFrame, c: g.cancelAnimationFrame };
  g.requestAnimationFrame = (cb) => queue.push(cb);
  g.cancelAnimationFrame = () => {
    queue = [];
  };
  try {
    run(
      (t) => {
        const now = queue;
        queue = [];
        for (const cb of now) cb(t);
      },
      () => queue.length,
    );
  } finally {
    g.requestAnimationFrame = prev.r;
    g.cancelAnimationFrame = prev.c;
  }
}

test('one rAF chain; animation time capped, real time passed through', () => {
  withFakeRaf((step, pending) => {
    const perf = globalThis.performance;
    const loop = new FrameLoop();
    const seen: [number, number][] = [];
    loop.onFrame((a, r) => seen.push([a, r]));
    const start = perf.now();
    loop.start();
    loop.start();
    assert.equal(pending(), 1, 'start() twice still schedules one callback');
    step(start + 16);
    step(start + 96);
    step(start + 10_096);
    assert.equal(pending(), 1);
    assert.deepEqual(
      seen.map(([a, r]) => [Math.round(a), Math.round(r)]),
      [
        [16, 16],
        [50, 80],
        [50, 250],
      ],
    );
    loop.stop();
    assert.equal(pending(), 0);
  });
});

test('a fragile hazard fails after the same real time at 60, 12 and 8 fps', () => {
  const level: LevelDef = {
    id: 950,
    name: 'T',
    objective: '',
    shelves: [
      { slots: 5, maxWeight: 20 },
      { slots: 5, maxWeight: 20 },
    ],
    packages: ['fragile', 'heavy'],
    balanceTolerance: 99,
  };
  const failAt = (frameMs: number) => {
    const s = new GameSession(level, { source: { mode: 'campaign', levelId: 950 } });
    s.move(0, 0, 2);
    s.move(1, 1, 2);
    let t = 0;
    while (s.phase === 'play' && t < 20_000) {
      s.advance(frameMs);
      t += frameMs;
    }
    return t;
  };
  for (const frame of [1000 / 60, 80, 125]) {
    const t = failAt(frame);
    assert.ok(Math.abs(t - GRACE_MS.fragile) <= frame, `${frame.toFixed(1)} ms frames failed at ${t.toFixed(0)} ms`);
  }
});
