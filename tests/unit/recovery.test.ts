/**
 * Recovery from an unexpected error (src/app/recovery.ts): whose errors are
 * the game's, one recovery per burst, and a crash loop that holds instead of
 * spinning. The browser wiring runs on a plain EventTarget with fake hooks.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COALESCE_MS,
  CRASH_WINDOW_MS,
  MAX_RECOVERIES,
  RecoveryPolicy,
  installRecovery,
  isForeignError,
} from '../../src/app/recovery';
import type { RecoveryHooks } from '../../src/app/recovery';

const ORIGIN = 'https://localhost';

test('the game\'s own errors are recognised; extension, cross-origin and benign ones are not', () => {
  const ours = [
    { message: 'x is undefined', filename: `${ORIGIN}/assets/index-abc.js` },
    { message: 'boom', stack: `Error: boom\n    at f (${ORIGIN}/assets/index-abc.js:1:2)` },
    { message: 'boom' },
    { message: 'boom', stack: 'Error: boom\n    at <anonymous>' },
    { message: 'Cannot read properties of null', name: 'TypeError', stack: `TypeError\n at ${ORIGIN}/a.js:1:1` },
  ];
  for (const info of ours) assert.equal(isForeignError(info, ORIGIN), false, JSON.stringify(info));

  const foreign = [
    { message: 'ext', filename: 'chrome-extension://abcdef/content.js' },
    { message: 'ext', filename: 'moz-extension://abcdef/content.js' },
    { message: 'ext', stack: 'Error: ext\n    at x (chrome-extension://abcdef/inject.js:3:9)' },
    { message: 'other site', filename: 'https://ads.example.com/tag.js' },
    { message: 'Script error.' },
    { message: 'ResizeObserver loop completed with undelivered notifications.' },
    { message: 'The play() request was interrupted', name: 'AbortError' },
    { message: 'play() failed because the user did not interact', name: 'NotAllowedError' },
  ];
  for (const info of foreign) assert.equal(isForeignError(info, ORIGIN), true, JSON.stringify(info));
});

test('policy: recover, coalesce a burst, hold a crash loop once, reset after a quiet window', () => {
  const p = new RecoveryPolicy();
  let t = 1_000_000;
  assert.equal(p.record(t), 'recover');
  // The same frame / burst: part of that recovery.
  assert.equal(p.record(t + 1), 'ignore');
  assert.equal(p.record(t + COALESCE_MS - 1), 'ignore');
  // Each later error within the window recovers again, up to the limit.
  for (let i = 1; i < MAX_RECOVERIES; i++) {
    t += COALESCE_MS;
    assert.equal(p.record(t), 'recover', `recovery ${i + 1}`);
  }
  t += COALESCE_MS;
  assert.equal(p.record(t), 'hold', 'one error too many: hold (notice, no navigation)');
  assert.equal(p.held, true);
  // A loop that keeps throwing (every frame) stays quiet: nothing more is done.
  for (let i = 0; i < 600; i++) {
    t += 16;
    assert.equal(p.record(t), 'ignore');
  }
  assert.equal(p.held, true);
  // Quiet for a whole window: the next error is recovered from again.
  t += CRASH_WINDOW_MS;
  assert.equal(p.record(t), 'recover');
  assert.equal(p.held, false);
});

test('policy: errors spread wider than the window never hold', () => {
  // Spaced so that at most MAX_RECOVERIES errors ever fall inside one window.
  const q = new RecoveryPolicy();
  const spaced = Array.from({ length: 20 }, (_, i) => q.record(i * (CRASH_WINDOW_MS / (MAX_RECOVERIES - 1) + 1)));
  assert.ok(spaced.every((a) => a === 'recover'), spaced.join(','));
});

function harness() {
  const target = new EventTarget();
  const calls: string[] = [];
  const queue: (() => void)[] = [];
  let clock = 5_000;
  let menuThrows = false;
  const hooks: RecoveryHooks = {
    flush: () => calls.push('flush'),
    toMenu: () => {
      calls.push('menu');
      if (menuThrows) throw new Error('menu failed');
    },
    notify: () => calls.push('notice'),
    log: (_e, action) => calls.push(`log:${action}`),
  };
  const recovery = installRecovery(target, hooks, {
    origin: ORIGIN,
    now: () => clock,
    schedule: (run) => queue.push(run),
  });
  const errorEvent = (init: { message?: string; filename?: string; error?: unknown }) => {
    const e = new Event('error', { cancelable: true }) as Event & typeof init;
    Object.assign(e, init);
    target.dispatchEvent(e);
    return e;
  };
  const rejection = (reason: unknown) => {
    const e = new Event('unhandledrejection', { cancelable: true }) as Event & { reason: unknown };
    e.reason = reason;
    target.dispatchEvent(e);
    return e;
  };
  return {
    recovery,
    calls,
    errorEvent,
    rejection,
    run: () => {
      while (queue.length) queue.shift()!();
    },
    advance: (ms: number) => (clock += ms),
    menuThrows: (v: boolean) => (menuThrows = v),
  };
}

test('wiring: a game error saves, goes to the menu and shows the notice, once per burst', () => {
  const h = harness();
  const err = new Error('boom');
  err.stack = `Error: boom\n    at f (${ORIGIN}/assets/index.js:1:1)`;
  const e = h.errorEvent({ message: 'Uncaught Error: boom', filename: `${ORIGIN}/assets/index.js`, error: err });
  assert.equal(e.defaultPrevented, true, 'handled: no second "Uncaught" line');
  // More errors from the same frame before the recovery runs: still one recovery.
  h.recovery.report(err);
  h.rejection(err);
  assert.deepEqual(h.calls, ['log:recover'], 'logged once; nothing done inside the throwing frame');
  h.run();
  assert.deepEqual(h.calls, ['log:recover', 'flush', 'menu', 'notice']);
});

test('wiring: errors that are not the game\'s are left alone', () => {
  const h = harness();
  const e = h.errorEvent({ message: 'ext', filename: 'chrome-extension://abc/content.js', error: new Error('ext') });
  const r = h.rejection(Object.assign(new Error('interrupted'), { name: 'AbortError' }));
  const s = h.errorEvent({ message: 'Script error.' });
  h.run();
  assert.deepEqual(h.calls, []);
  assert.equal(e.defaultPrevented, false);
  assert.equal(r.defaultPrevented, false);
  assert.equal(s.defaultPrevented, false);
});

test('wiring: a crash loop holds - the notice once more, no more trips to the menu, no log spam', () => {
  const h = harness();
  const fire = () => h.recovery.report(new Error('every frame'));
  for (let i = 0; i < 10 * 60; i++) {
    fire();
    h.run();
    h.advance(16);
  }
  const menus = h.calls.filter((c) => c === 'menu').length;
  const logs = h.calls.filter((c) => c.startsWith('log:')).length;
  assert.equal(menus, MAX_RECOVERIES, h.calls.join(' '));
  assert.equal(logs, MAX_RECOVERIES + 1, 'each recovery and the hold are logged; the rest are quiet');
  assert.equal(h.calls.filter((c) => c === 'log:hold').length, 1);
  assert.equal(h.calls.filter((c) => c === 'notice').length, MAX_RECOVERIES + 1);
  assert.equal(h.calls[h.calls.length - 1], 'notice', 'the hold shows the notice and does not navigate');
});

test('wiring: a menu that fails to open does not stop the save or the notice', () => {
  const h = harness();
  h.menuThrows(true);
  h.recovery.report(new Error('boom'));
  h.run();
  assert.deepEqual(h.calls, ['log:recover', 'flush', 'menu', 'notice']);
});
