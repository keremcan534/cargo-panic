/**
 * The 2D first-load path in the production build:
 *
 * - a saved 2D preference boots without ever creating a WebGL context or
 *   requesting the three.js / ThreeStage chunks, and level 1 is played to
 *   the win panel with real pointer drags;
 * - the main menu's settings panel switches to 3D - only then are the 3D
 *   chunks fetched and a WebGL context made - and stores the choice.
 *
 * Headless desktop Chromium with a phone viewport: functional checks, not a
 * device or performance measurement. Screenshots: test-results/a2b/.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  Hand,
  appMode,
  bootToMenu,
  frames,
  gameMode,
  openWithSave,
  pickView,
  snapshot,
  startLevel,
  storedSave,
} from './support/game';
import { saveData, v2Save } from './support/save';

const SHOTS = 'test-results/a2b';

/** Records every getContext kind the page asks for (init script). */
function recordContexts() {
  const w = window as unknown as { __contexts: string[] };
  w.__contexts = [];
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
    w.__contexts.push(kind);
    return (orig as (...a: unknown[]) => unknown).call(this, kind, ...rest);
  } as typeof orig;
}

const contexts = (page: Page) => page.evaluate(() => (window as unknown as { __contexts: string[] }).__contexts);
const isWebgl = (k: string) => /webgl/i.test(k);
const is3dChunk = (url: string) => url.includes('/three-') || url.includes('ThreeStage');

test('2D boot: no WebGL context, no three.js chunk, level 1 played to the win panel', async ({ browser, baseURL }) => {
  test.slow();
  const save = v2Save((d) => {
    d.settings.renderMode = '2d';
  }, 1);
  const { context, page, errors } = await openWithSave(browser, baseURL, save, recordContexts);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));

  await bootToMenu(page);
  expect(await appMode(page)).toBe('2d');
  await page.locator('[data-role="play"]').dispatchEvent('click');
  await page.waitForFunction(() => !!window.__cargoPanic);
  await expect(page.locator('.hud .title')).toHaveText('LEVEL 1');
  expect(await gameMode(page)).toBe('2d');
  await frames(page, 5);

  const hand = new Hand(page);
  await hand.drag(0, { shelf: 0, slot: 1, slots: 1 });
  await expect.poll(async () => (await snapshot(page)).placements).toEqual([{ id: 0, type: 'standard', shelf: 0, slot: 1 }]);
  await frames(page, 30); // landing and belt slide finish
  await page.screenshot({ path: `${SHOTS}/2d-level1.png` });

  await hand.drag(1, { shelf: 0, slot: 3, slots: 1 });
  await expect(page.locator('.modal .headline')).toHaveText('SECURED', { timeout: 30_000 });
  const snap = await snapshot(page);
  expect(snap.phase).toBe('won');
  expect(snap.outcome?.imbalance).toBe(0);
  await expect(page.locator('.modal .star:not(.off)')).toHaveCount(3);
  await page.screenshot({ path: `${SHOTS}/2d-level1-won.png` });

  const kinds = await contexts(page);
  test.info().annotations.push({ type: 'contexts', description: [...new Set(kinds)].join(',') });
  expect(kinds.filter(isWebgl)).toEqual([]);
  expect(kinds.length).toBeGreaterThan(0);
  expect(requests.filter(is3dChunk)).toEqual([]);
  expect(await page.locator('canvas').count()).toBe(1);
  expect(errors).toEqual([]);
  await context.close();
});

test('2D level 25: every tier, the sealed aisle, a long package placed', async ({ browser, baseURL }) => {
  test.slow();
  const save = v2Save((d) => {
    d.settings.renderMode = '2d';
  });
  const { context, page, errors } = await openWithSave(browser, baseURL, save);
  await bootToMenu(page);
  await startLevel(page, 25);
  expect(await gameMode(page)).toBe('2d');
  await frames(page, 20);
  await page.screenshot({ path: `${SHOTS}/2d-level25.png` });

  const hand = new Hand(page);
  await hand.grab(0);
  await hand.aim({ shelf: 3, slot: 1, slots: 3 });
  await page.screenshot({ path: `${SHOTS}/2d-level25-drag-long.png` });
  await hand.release();
  await expect.poll(async () => (await snapshot(page)).placements).toEqual([{ id: 0, type: 'long', shelf: 3, slot: 1 }]);
  await frames(page, 30);
  await page.screenshot({ path: `${SHOTS}/2d-level25-midplay.png` });
  expect(errors).toEqual([]);
  await context.close();
});

test('menu settings: 3D is fetched only when chosen, and the choice is stored', async ({ browser, baseURL }) => {
  test.slow();
  const save = v2Save((d) => {
    d.settings.renderMode = '2d';
  });
  const { context, page, errors } = await openWithSave(browser, baseURL, save, recordContexts);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await bootToMenu(page);
  await expect(page.locator('[data-role="settings"]')).toContainText('2D');

  await page.locator('[data-role="settings"]').dispatchEvent('click');
  await expect(page.locator('.modal .headline')).toHaveText('SETTINGS');
  await expect(page.locator('[data-role="view"] [data-value="2d"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-role="quality"]')).toBeHidden(); // 3D quality only shows in 3D
  await frames(page, 10);
  await page.screenshot({ path: `${SHOTS}/2d-menu-settings.png` });
  expect(requests.filter(is3dChunk)).toEqual([]);
  expect((await contexts(page)).filter(isWebgl)).toEqual([]);

  await pickView(page, '3d');
  expect(requests.filter(is3dChunk).length).toBeGreaterThanOrEqual(2); // ThreeStage + three
  expect((await contexts(page)).filter(isWebgl).length).toBeGreaterThan(0);
  await expect(page.locator('[data-role="view"] [data-value="3d"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-role="quality"]')).toBeVisible();
  await expect(page.locator('[data-role="settings"]')).toContainText('3D');
  expect(await page.locator('canvas').count()).toBe(1);
  expect(saveData(await storedSave(page))?.settings.renderMode).toBe('3d');

  // Quality is stored and applied to the live 3D stage.
  await page.locator('[data-role="quality"] [data-value="low"]').dispatchEvent('click');
  await expect.poll(() => page.evaluate(() => window.__cargoPanicApp!.quality)).toMatchObject({
    preference: 'low',
    pixelRatio: 1,
    shadows: false,
    profile: { bloom: false, shadows: false, dprCap: 1 },
  });
  expect(saveData(await storedSave(page))?.settings.quality).toBe('low');
  await frames(page, 2);
  await page.screenshot({ path: `${SHOTS}/3d-menu-settings.png` });

  // A reload starts in the stored view.
  await page.locator('[data-role="close-settings"]').dispatchEvent('click');
  await page.reload();
  await expect(page.locator('.menu [data-role="play"]')).toBeVisible({ timeout: 90_000 });
  expect(await appMode(page)).toBe('3d');
  expect(await page.evaluate(() => window.__cargoPanicApp!.quality?.preference)).toBe('low');

  // ...and back to 2D, which is stored too.
  await page.locator('[data-role="settings"]').dispatchEvent('click');
  await pickView(page, '2d');
  expect(saveData(await storedSave(page))?.settings.renderMode).toBe('2d');
  expect(await page.locator('canvas').count()).toBe(1);
  expect(errors).toEqual([]);
  await context.close();
});
