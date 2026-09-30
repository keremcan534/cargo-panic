/**
 * The ads boundary in front of the hint button (src/platform/ads.ts):
 * with NoAds hints stay free; with a provider, a hint needs a finished
 * rewarded ad, except in the first three campaign levels.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { requestHint, setHintGate, type HintContext } from '../../src/game/systems/HintService';
import { installAds, NoAds, type AdProvider, type RewardedResult } from '../../src/platform/ads';

afterEach(() => setHintGate(null));

const LEVEL_7: HintContext = { mode: 'campaign', level: 7 };

/** Asks for a hint and reports what the gate decided, once it has. */
function ask(context?: HintContext): Promise<'granted' | 'denied'> & { settled: () => string } {
  let state = 'pending';
  const p = new Promise<'granted' | 'denied'>((resolve) =>
    requestHint(
      () => resolve((state = 'granted') as 'granted'),
      () => resolve((state = 'denied') as 'denied'),
      context,
    ),
  );
  return Object.assign(p, { settled: () => state });
}

/** A provider whose ad the test finishes by hand. */
function fakeProvider(available = true) {
  const pending: ((r: RewardedResult) => void)[] = [];
  let shown = 0;
  const provider: AdProvider = {
    isAvailable: () => available,
    showRewarded: () => {
      shown++;
      return new Promise((resolve) => pending.push(resolve));
    },
  };
  return {
    provider,
    get shown() {
      return shown;
    },
    finish: (r: RewardedResult) => pending.shift()!(r),
  };
}

test('NoAds: the gate is not installed and every hint is free, at once', () => {
  assert.equal(NoAds.isAvailable(), false);
  assert.equal(installAds(NoAds), false);
  assert.equal(installAds(), false);
  for (const ctx of [undefined, LEVEL_7, { mode: 'endless', level: 12 } as HintContext]) {
    const r = ask(ctx);
    assert.equal(r.settled(), 'granted', 'granted synchronously, exactly as without the boundary');
  }
});

test('a provider that cannot show ads leaves hints free and never shows one', () => {
  const fake = fakeProvider(false);
  assert.equal(installAds(fake.provider), false);
  assert.equal(ask(LEVEL_7).settled(), 'granted');
  assert.equal(fake.shown, 0);
});

test('with a provider, the hint comes only after a rewarded ad', async () => {
  const fake = fakeProvider();
  assert.equal(installAds(fake.provider), true);

  const r = ask(LEVEL_7);
  assert.equal(fake.shown, 1);
  await Promise.resolve();
  assert.equal(r.settled(), 'pending', 'nothing before the ad ends');
  fake.finish('rewarded');
  assert.equal(await r, 'granted');
});

test('dismissed, failed or a rejected ad: no hint', async () => {
  const fake = fakeProvider();
  installAds(fake.provider);
  for (const result of ['dismissed', 'failed'] as const) {
    const r = ask(LEVEL_7);
    fake.finish(result);
    assert.equal(await r, 'denied', result);
  }
  const broken: AdProvider = { isAvailable: () => true, showRewarded: () => Promise.reject(new Error('sdk')) };
  installAds(broken);
  assert.equal(await ask(LEVEL_7), 'denied');
});

test('one ad at a time: a second request while one shows is denied', async () => {
  const fake = fakeProvider();
  installAds(fake.provider);
  const first = ask(LEVEL_7);
  assert.equal(await ask(LEVEL_7), 'denied');
  assert.equal(fake.shown, 1);
  fake.finish('rewarded');
  assert.equal(await first, 'granted');
});

test('no ad offers in the first three campaign levels', async () => {
  const fake = fakeProvider();
  installAds(fake.provider);
  for (const level of [1, 2, 3]) assert.equal(ask({ mode: 'campaign', level }).settled(), 'granted');
  assert.equal(fake.shown, 0);

  const r = ask({ mode: 'campaign', level: 4 });
  assert.equal(fake.shown, 1);
  fake.finish('rewarded');
  assert.equal(await r, 'granted');
});

test('installing NoAds after a provider restores free hints', () => {
  installAds(fakeProvider().provider);
  installAds(NoAds);
  assert.equal(ask(LEVEL_7).settled(), 'granted');
});
