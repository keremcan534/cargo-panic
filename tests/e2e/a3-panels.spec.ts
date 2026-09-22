/**
 * A3 in the real game, beyond the controls: honest loss reasons with the
 * shelf pointed at, RETRY SAME SHIFT vs NEW SHIFT, the reduced-motion
 * setting, Turkish, and the first-session guide (with no ad, store, mission
 * or shop element anywhere in levels 1-3).
 *
 * Headless desktop Chromium with a phone viewport: functional checks, not
 * device measurements. Some tests run at 360 x 640 to look at the smallest
 * phone. Screenshots: test-results/a3/.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { levelFingerprint } from '../../src/game/session/fingerprint';
import {
  bootToMenu,
  frames,
  openWithSave,
  pointOf,
  selectCargo,
  settledOn,
  snapshot,
  startLevel,
  storedSave,
  tapTarget,
} from './support/game';
import { saveData, v2Save } from './support/save';

const SHOTS = 'test-results/a3';
const SMALL = { width: 360, height: 640 };

const placements = async (page: Page) => (await snapshot(page)).placements;
const NO_UPSELL = '[data-role^="ad"], .store, .mission, .shop';

const quietSave = (mode: '2d' | '3d', edit: Parameters<typeof v2Save>[0] = () => undefined) =>
  v2Save((d) => {
    d.settings.renderMode = mode;
    d.tutorial.skipped = true;
    d.tutorial.seenCargo = ['heavy', 'fragile', 'long', 'priority'];
    edit(d);
  });

/** Selects `cargo` and taps it onto a slot. */
async function tapPlace(page: Page, cargo: number, t: { shelf: number; slot: number; slots: number }) {
  await selectCargo(page, cargo);
  await tapTarget(page, t);
  await expect.poll(async () => (await placements(page)).some((p) => p.id === cargo && p.shelf === t.shelf && p.slot === t.slot), {
    timeout: 60_000,
  }).toBe(true);
}

// ---------------------------------------------------------------------------

for (const mode of ['2d', '3d'] as const) {
  test(`${mode}: an overload loss names the shelf and its real load and rating, and points at the shelf`, async ({
    browser,
    baseURL,
  }) => {
    test.slow();
    const { context, page, errors } = await openWithSave(browser, baseURL, quietSave(mode), undefined, {
      viewport: mode === '2d' ? SMALL : undefined,
    });
    await bootToMenu(page);
    await startLevel(page, 5); // top shelf rated 8
    // heavy (5) + box (2) + heavy (5) on the top shelf: 12 against 8; the lean stays under the red line.
    await tapPlace(page, 0, { shelf: 1, slot: 2, slots: 1 });
    await tapPlace(page, 1, { shelf: 1, slot: 1, slots: 1 });
    await tapPlace(page, 2, { shelf: 1, slot: 3, slots: 1 });
    await expect(page.locator('.hazard.on')).toContainText('SHELF OVERLOADED');

    await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe('failed');
    const snap = await snapshot(page);
    expect(snap.outcome?.failure).toEqual({ kind: 'overload', tier: 1, load: 12, max: 8 });
    // During the fall, before the panel: the shelf is outlined.
    await page.screenshot({ path: `${SHOTS}/${mode}-overload-highlight.png` });

    const detail = page.locator('.modal [data-role="fail-detail"]');
    await expect(detail).toHaveText('The top shelf carried 12 against a rating of 8.', { timeout: 30_000 });
    await expect(page.locator('.modal .headline')).toHaveText('SHELF OVERLOADED');
    await frames(page, mode === '3d' ? 2 : 10);
    await page.screenshot({ path: `${SHOTS}/${mode}-overload-loss-panel.png` });
    expect(errors).toEqual([]);
    await context.close();
  });
}

test('2d: run over - RETRY SAME SHIFT replays the same seed from wave 1, NEW SHIFT deals a new one', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave('2d'));
  await bootToMenu(page, '&seed=12345');
  await page.locator('.menu [data-role="endless"]').dispatchEvent('click');
  await expect(page.locator('.hud .title')).toHaveText('WAVE 1', { timeout: 60_000 });
  await page.waitForFunction(() => !!window.__cargoPanic);
  await frames(page, 5);
  const first = await snapshot(page);
  expect(first.source).toMatchObject({ mode: 'endless', seed: 12345, wave: 1 });
  const firstPrint = levelFingerprint(await page.evaluate(() => window.__cargoPanic!.board().level));

  /** Seed 12345, wave 1: one box on the far right of the top shelf tips the rack (7.5 > 7). */
  const loseWave = async () => {
    const top = (await page.evaluate(() => window.__cargoPanic!.board().level.shelves.length)) - 1;
    const slots = await page.evaluate((t) => window.__cargoPanic!.board().level.shelves[t].slots, top);
    await tapPlace(page, 0, { shelf: top, slot: slots - 1, slots: 1 });
    await expect(page.locator('.modal .kicker')).toHaveText('RUN OVER', { timeout: 60_000 });
  };

  await loseWave();
  await expect(page.locator('.modal [data-role="fail-detail"]')).toHaveText(
    'Imbalance reached 7.5 against a limit of 7.0. The rack leaned right.',
  );
  await expect(page.locator('.modal [data-role="shift-code"]')).toHaveText('SHIFT 9IX');
  await expect(page.locator('.modal [data-role="retry-same"]')).toHaveText('RETRY SAME SHIFT');
  await expect(page.locator('.modal [data-role="new-shift"]')).toHaveText('NEW SHIFT');
  await expect(page.locator('.modal [data-role="assisted"]')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/2d-run-over.png` });

  // Same shift: same seed and the identical wave 1 - but a new run.
  let hook = await page.evaluateHandle(() => window.__cargoPanic);
  await page.locator('.modal [data-role="retry-same"]').dispatchEvent('click');
  await page.waitForFunction((old) => !!window.__cargoPanic && window.__cargoPanic !== old, hook);
  await frames(page, 5);
  const same = await snapshot(page);
  expect(same.source).toMatchObject({ mode: 'endless', seed: 12345, wave: 1 });
  expect((same.source as { runId: string }).runId).not.toBe((first.source as { runId: string }).runId);
  expect(same.placements).toEqual([]);
  expect(levelFingerprint(await page.evaluate(() => window.__cargoPanic!.board().level))).toBe(firstPrint);

  // New shift: another seed.
  await loseWave();
  hook = await page.evaluateHandle(() => window.__cargoPanic);
  await page.locator('.modal [data-role="new-shift"]').dispatchEvent('click');
  await page.waitForFunction((old) => !!window.__cargoPanic && window.__cargoPanic !== old, hook);
  await frames(page, 5);
  const fresh = await snapshot(page);
  expect(fresh.source).toMatchObject({ mode: 'endless', wave: 1 });
  expect((fresh.source as { seed: number }).seed).not.toBe(12345);
  expect(errors).toEqual([]);
  await context.close();
});

test('2d: REDUCED MOTION is stored, reaches the page and the stage, follows the system on SYSTEM', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave('2d'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await bootToMenu(page);
  const hasClass = () => page.evaluate(() => document.documentElement.classList.contains('reduced-motion'));
  const stageReduced = () => page.evaluate(() => window.__cargoPanicApp!.reducedMotion);
  expect(await hasClass()).toBe(false);

  await page.locator('[data-role="settings"]').dispatchEvent('click');
  const row = page.locator('[data-role="motion"]');
  await expect(row.locator('[data-value="system"]')).toHaveAttribute('aria-checked', 'true');
  await row.locator('[data-value="on"]').dispatchEvent('click');
  await expect(row.locator('[data-value="on"]')).toHaveAttribute('aria-checked', 'true');
  expect(await hasClass()).toBe(true);
  expect(await stageReduced()).toBe(true);
  expect(saveData(await storedSave(page))?.settings.reducedMotion).toBe(true);
  await frames(page, 5);
  await page.screenshot({ path: `${SHOTS}/2d-settings-reduced-motion.png` });

  // A reload keeps it.
  await page.reload();
  await expect(page.locator('.menu [data-role="play"]')).toBeVisible({ timeout: 90_000 });
  expect(await hasClass()).toBe(true);
  expect(await stageReduced()).toBe(true);

  // In game too (a new stage reads it), then SYSTEM follows the device live.
  await startLevel(page, 4);
  expect(await stageReduced()).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal .headline')).toHaveText('PAUSED');
  await page.locator('[data-role="motion"] [data-value="system"]').dispatchEvent('click');
  expect(await hasClass()).toBe(false);
  expect(await stageReduced()).toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(hasClass).toBe(true);
  expect(await stageReduced()).toBe(true);
  expect(saveData(await storedSave(page))?.settings.reducedMotion).toBeNull();
  expect(errors).toEqual([]);
  await context.close();
});

test('Turkish: a TR save shows the Turkish menu and a Turkish in-game hazard banner (360 x 640)', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const save = quietSave('2d', (d) => {
    d.settings.language = 'tr';
  });
  const { context, page, errors } = await openWithSave(browser, baseURL, save, undefined, { viewport: SMALL });
  await page.goto('/?e2e');
  await expect(page.locator('.menu [data-role="play"]')).toHaveText('OYNA', { timeout: 90_000 });
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('tr');
  await expect(page.locator('.menu [data-role="endless"]')).toHaveText('SONSUZ VARDİYA');
  await frames(page, 10);
  await page.screenshot({ path: `${SHOTS}/tr-menu-360.png` });

  await page.locator('.menu [data-role="levels"]').dispatchEvent('click');
  await page.locator('[data-level="4"]').dispatchEvent('click');
  await expect(page.locator('.hud .title')).toHaveText('BÖLÜM 4', { timeout: 60_000 });
  await page.waitForFunction(() => !!window.__cargoPanic);
  await frames(page, 5);
  await expect(page.locator('[data-role="undo"]')).toHaveText('GERİ AL');
  await tapPlace(page, 0, { shelf: 0, slot: 4, slots: 1 }); // a heavy crate at the edge tips the rack
  const banner = page.locator('.hazard.on');
  await expect(banner).toContainText('RAF DEVRİLİYOR');
  await expect(banner).toContainText('DÜZELT');
  await expect(banner).toContainText(/\d,\d sn/);
  await expect(banner.locator('.warn-icon svg')).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/tr-hud-hazard-360.png` });
  expect(errors).toEqual([]);
  await context.close();
});

// ---------------------------------------------------------------------------
// First-session guide.
// ---------------------------------------------------------------------------

test('guide: a fresh save shows the level 1 hand, it goes after the first placement; SKIP works; no upsell in levels 1-2', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  // A fresh save (nothing stored). It starts in 3D; the test moves to 2D for speed.
  const { context, page, errors } = await openWithSave(browser, baseURL, null);
  await page.goto('/?e2e');
  await expect(page.locator('.menu [data-role="play"]')).toHaveText('PLAY', { timeout: 90_000 });
  expect(await page.locator(NO_UPSELL).count()).toBe(0);
  await page.locator('[data-role="settings"]').dispatchEvent('click');
  await page.locator('[data-role="view"] [data-value="2d"]').dispatchEvent('click');
  await settledOn(page, '2d');
  await page.locator('[data-role="close-settings"]').dispatchEvent('click');

  await page.locator('.menu [data-role="play"]').dispatchEvent('click');
  await expect(page.locator('.hud .title')).toHaveText('LEVEL 1', { timeout: 60_000 });
  await page.waitForFunction(() => !!window.__cargoPanic);
  const guide = page.locator('[data-role="tutorial"]');
  await expect(guide).toBeVisible();
  await expect(guide).toHaveAttribute('data-step', 'place');
  await expect(guide.locator('.tut-hand')).toBeVisible();
  await expect(guide.locator('.tut-ring')).toBeVisible();
  await expect(guide).toContainText('Drag the box from the belt onto the shelf.');
  expect(await page.locator('.tip:not(.out)').count()).toBe(0); // the guide replaces the level tip
  await frames(page, 30);
  await page.screenshot({ path: `${SHOTS}/2d-guide-level1-hand.png` });
  expect(await page.locator(NO_UPSELL).count()).toBe(0);

  // The guide takes no input: the first placement goes straight through it.
  await tapPlace(page, 0, { shelf: 0, slot: 1, slots: 1 });
  await expect(guide).toHaveCount(0);
  expect(saveData(await storedSave(page))?.tutorial.done).toEqual(['place']);
  expect((await snapshot(page)).assists).toEqual({ hints: 0, undos: 0 }); // the demo hand is not a hint

  await tapPlace(page, 1, { shelf: 0, slot: 3, slots: 1 });
  await expect(page.locator('.modal .headline')).toHaveText('SECURED', { timeout: 30_000 });
  await expect(page.locator('.modal [data-role="next"]')).toHaveText('NEXT LEVEL');
  expect(await page.locator(NO_UPSELL).count()).toBe(0);

  // Level 2: the preview step appears when a package is picked; SKIP ends the guide, the game goes on.
  await page.locator('.modal [data-role="next"]').dispatchEvent('click');
  await expect(page.locator('.hud .title')).toHaveText('LEVEL 2', { timeout: 60_000 });
  await page.waitForFunction(() => JSON.stringify(window.__cargoPanic?.snapshot().source) === JSON.stringify({ mode: 'campaign', levelId: 2 }));
  await frames(page, 5);
  const guide2 = page.locator('[data-role="tutorial"]');
  await expect(guide2).toBeHidden();
  await selectCargo(page, 0);
  await expect(guide2).toBeVisible();
  await expect(guide2).toHaveAttribute('data-step', 'preview');
  await expect(guide2.locator('.tut-arrow')).toBeVisible();
  expect(await page.locator(NO_UPSELL).count()).toBe(0);
  await page.screenshot({ path: `${SHOTS}/2d-guide-level2-preview.png` });
  const before = await snapshot(page);
  await guide2.locator('[data-role="skip-tutorial"]').click();
  await expect(guide2).toHaveCount(0);
  const after = await snapshot(page);
  expect(after.phase).toBe('play');
  expect(after.placements).toEqual(before.placements);
  expect(after.queue).toEqual(before.queue);
  expect(saveData(await storedSave(page))?.tutorial.skipped).toBe(true);
  // Play carries straight on.
  await tapTarget(page, { shelf: 0, slot: 0, slots: 1 });
  await expect.poll(() => placements(page)).toEqual([{ id: 0, type: 'standard', shelf: 0, slot: 0 }]);
  expect(errors).toEqual([]);
  await context.close();
});

test('guide: level 3 points at a stowed package after the first stow and leaves once one is moved; no upsell', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const save = v2Save((d) => {
    d.settings.renderMode = '2d';
  }, 3);
  const { context, page, errors } = await openWithSave(browser, baseURL, save);
  await bootToMenu(page);
  await startLevel(page, 3);
  const guide = page.locator('[data-role="tutorial"]');
  await expect(guide).toBeHidden();
  expect(await page.locator(NO_UPSELL).count()).toBe(0);

  await tapPlace(page, 0, { shelf: 0, slot: 2, slots: 1 });
  await expect(guide).toBeVisible();
  await expect(guide).toHaveAttribute('data-step', 'move');
  await expect(guide.locator('.tut-hand')).toBeVisible();
  // The hand is on the stowed package.
  const hand = await guide.locator('.tut-hand').boundingBox();
  const box = await pointOf(page, { cargo: 0 });
  expect(hand).not.toBeNull();
  expect(Math.abs(hand!.x + hand!.width * (22 / 48) - box.x)).toBeLessThan(6);
  await page.screenshot({ path: `${SHOTS}/2d-guide-level3-move.png` });

  // Another belt package does not finish it; moving the stowed one does.
  await tapPlace(page, 1, { shelf: 1, slot: 2, slots: 1 });
  await expect(guide).toBeVisible();
  await tapPlace(page, 0, { shelf: 0, slot: 1, slots: 1 });
  await expect(guide).toHaveCount(0);
  expect(saveData(await storedSave(page))?.tutorial.done).toEqual(['move']);
  expect(await page.locator(NO_UPSELL).count()).toBe(0);
  expect(errors).toEqual([]);
  await context.close();
});
