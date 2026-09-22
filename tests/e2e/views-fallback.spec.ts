/**
 * When 3D cannot run, the game runs in 2D - same save, same session:
 *
 * - no WebGL (getContext returns null for webgl/webgl2): a saved 3D
 *   preference opens in 2D with the notice, the stored preference stays 3D,
 *   and picking 3D from the pause panel stays in 2D with the same session;
 * - the three.js chunk cannot be fetched: same fallback;
 * - the WebGL context is lost mid-game: the game pauses at once, and if the
 *   context is not back within ~2 s it continues in 2D with the same
 *   session, paused, with the notice; a context that comes back in time
 *   keeps 3D and resumes;
 * - a 3D stage that stays slow at its lowest quality offers 2D between
 *   shipments only, and never switches by itself.
 *
 * Headless desktop Chromium + SwiftShader: functional checks only.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { t } from '../../src/i18n';
import {
  Hand,
  appMode,
  bootToMenu,
  frames,
  gameMode,
  openWithSave,
  pause,
  pickView,
  rules,
  settledOn,
  snapshot,
  startLevel,
  storedSave,
} from './support/game';
import { saveData, v2Save } from './support/save';

const SHOTS = 'test-results/a2b';
const FALLBACK = t('render.fallback2d');

/** WebGL is unavailable: every webgl context request returns null (init script). */
function noWebgl() {
  const orig = HTMLCanvasElement.prototype.getContext;
  const w = window as unknown as { __webglAsked: number };
  w.__webglAsked = 0;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
    if (/webgl/i.test(kind)) {
      w.__webglAsked++;
      return null;
    }
    return (orig as (...a: unknown[]) => unknown).call(this, kind, ...rest);
  } as typeof orig;
}

const save3d = (quality: 'auto' | 'low' | 'high' = 'auto') =>
  v2Save((d) => {
    d.settings.renderMode = '3d';
    d.settings.quality = quality;
  });

const storedMode = async (page: Page) => saveData(await storedSave(page))?.settings.renderMode;

test('no WebGL: a saved 3D preference opens in 2D with a notice and stays stored as 3D', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const { context, page, errors } = await openWithSave(browser, baseURL, save3d(), noWebgl);
  await bootToMenu(page);
  expect(await appMode(page)).toBe('2d');
  expect(await page.evaluate(() => window.__cargoPanicApp!.preference)).toBe('3d');
  await expect(page.locator('.notice')).toHaveText(FALLBACK);
  expect(await page.evaluate(() => (window as unknown as { __webglAsked: number }).__webglAsked)).toBeGreaterThan(0);
  expect(await page.locator('canvas').count()).toBe(1);
  expect(await storedMode(page)).toBe('3d');
  await page.screenshot({ path: `${SHOTS}/fallback-notice-menu.png` });

  await startLevel(page, 1);
  expect(await gameMode(page)).toBe('2d');
  const hand = new Hand(page);
  await hand.drag(0, { shelf: 0, slot: 1, slots: 1 });
  await expect.poll(async () => (await snapshot(page)).placements.length).toBe(1);

  // Picking 3D from the pause panel: still no WebGL, so the game stays in 2D with the same session.
  await pause(page);
  const paused = await rules(page);
  await expect(page.locator('.notice')).toHaveCount(0, { timeout: 15_000 }); // the boot notice has gone
  await pickView(page, '3d', '2d');
  await expect(page.locator('.notice')).toHaveText(FALLBACK);
  expect(await gameMode(page)).toBe('2d');
  expect(await rules(page)).toEqual(paused);
  await expect(page.locator('[data-role="view"] [data-value="2d"]')).toHaveAttribute('aria-checked', 'true');
  expect(await storedMode(page)).toBe('3d');
  expect(await page.locator('canvas').count()).toBe(1);
  await page.screenshot({ path: `${SHOTS}/fallback-notice-pause.png` });

  await page.locator('[data-role="resume"]').dispatchEvent('click');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('play');
  await hand.drag(1, { shelf: 0, slot: 3, slots: 1 });
  await expect(page.locator('.modal .headline')).toHaveText('SECURED', { timeout: 30_000 });
  expect(errors).toEqual([]);
  await context.close();
});

test('the 3D chunk failing to load falls back to 2D', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const { context, page, errors } = await openWithSave(browser, baseURL, save3d());
  const aborted: string[] = [];
  await context.route(/\/assets\/(three|ThreeStage)-[^/]+\.js$/, (route) => {
    aborted.push(route.request().url());
    return route.abort('failed');
  });
  await bootToMenu(page);
  expect(aborted.length).toBeGreaterThan(0);
  expect(await appMode(page)).toBe('2d');
  await expect(page.locator('.notice')).toHaveText(FALLBACK);
  expect(await storedMode(page)).toBe('3d');
  expect(await page.locator('canvas').count()).toBe(1);
  await startLevel(page, 1);
  expect(await gameMode(page)).toBe('2d');
  expect(errors).toEqual([]);
  await context.close();
});

/** Loses the live WebGL context through WEBGL_lose_context, keeping the extension to restore it. */
function loseContext(page: Page) {
  return page.evaluate(() => {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) return false;
    (window as unknown as { __lose: WEBGL_lose_context }).__lose = ext;
    ext.loseContext();
    return true;
  });
}

test('a lost WebGL context pauses at once and, if not back in time, continues in 2D with the same session', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(600_000);
  const { context, page, errors } = await openWithSave(browser, baseURL, save3d());
  await bootToMenu(page);
  await startLevel(page, 2);
  expect(await gameMode(page)).toBe('3d');
  const hand = new Hand(page);
  await hand.drag(0, { shelf: 0, slot: 1, slots: 1 });
  await expect.poll(async () => (await snapshot(page)).placements.length).toBe(1);
  const committed = await snapshot(page);

  expect(await loseContext(page)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__cargoPanic!.pauseReasons)).toContain('context-lost');
  expect((await snapshot(page)).phase).toBe('paused');
  const lost = await rules(page);

  // No restore: after the grace period the game moves to 2D, same session, paused, pause panel up.
  await settledOn(page, '2d');
  expect(await gameMode(page)).toBe('2d');
  await expect(page.locator('.notice')).toHaveText(FALLBACK);
  await expect(page.locator('.modal .headline')).toHaveText('PAUSED');
  expect(await page.evaluate(() => window.__cargoPanic!.pauseReasons)).toEqual(['menu']);
  expect(await rules(page)).toEqual(lost);
  expect(lost.placements).toEqual(committed.placements);
  expect(await storedMode(page)).toBe('3d'); // a fallback is not the player's choice
  expect(await page.locator('canvas').count()).toBe(1);
  await page.screenshot({ path: `${SHOTS}/context-lost-fallback.png` });

  await page.locator('[data-role="resume"]').dispatchEvent('click');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('play');
  await hand.drag(1, { shelf: 0, slot: 3, slots: 1 });
  await expect.poll(async () => (await snapshot(page)).placements.length).toBe(2);
  expect(errors).toEqual([]);
  await context.close();
});

test('a WebGL context restored in time keeps 3D and resumes', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const { context, page, errors } = await openWithSave(browser, baseURL, save3d());
  await bootToMenu(page);
  await startLevel(page, 2);
  expect(await loseContext(page)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__cargoPanic!.pauseReasons)).toContain('context-lost');
  await page.evaluate(() => (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext());
  await expect.poll(() => page.evaluate(() => window.__cargoPanic!.pauseReasons)).toEqual([]);
  expect((await snapshot(page)).phase).toBe('play');
  // Well past the grace period: still 3D, still drawing.
  await page.waitForTimeout(3000);
  await frames(page, 3);
  expect(await appMode(page)).toBe('3d');
  expect(await page.evaluate(() => window.__cargoPanicApp!.generation)).toBe(1); // no switch happened
  const hand = new Hand(page);
  await hand.drag(0, { shelf: 0, slot: 1, slots: 1 });
  await expect.poll(async () => (await snapshot(page)).placements.length).toBe(1);
  expect(errors).toEqual([]);
  await context.close();
});

test('slow 3D at its lowest quality offers 2D between shipments only, never mid-shipment', async ({ browser, baseURL }) => {
  test.setTimeout(600_000);
  // LOW is the lowest profile: one sustained slow stretch (SwiftShader frames here are all slow) makes it struggle.
  const { context, page, errors } = await openWithSave(browser, baseURL, save3d('low'));
  await bootToMenu(page);
  await startLevel(page, 1);
  await expect
    .poll(() => page.evaluate(() => window.__cargoPanicApp!.struggling), { timeout: 400_000, intervals: [2000] })
    .toBe(true);
  // Mid-shipment: no suggestion, no switch.
  expect(await page.locator('.suggest').count()).toBe(0);
  const hand = new Hand(page);
  await hand.drag(0, { shelf: 0, slot: 1, slots: 1 });
  expect(await page.locator('.suggest').count()).toBe(0);
  expect(await appMode(page)).toBe('3d');
  await hand.drag(1, { shelf: 0, slot: 3, slots: 1 });

  // Between shipments: offered once, next to the win panel.
  await expect(page.locator('.modal .headline')).toHaveText('SECURED', { timeout: 60_000 });
  const card = page.locator('.suggest');
  await expect(card).toContainText(t('render.slowSuggest'));
  await expect(card.locator('[data-role="switch-2d"]')).toHaveText(t('render.switchTo2d'));
  await expect(card.locator('[data-role="keep-3d"]')).toHaveText(t('render.keep3d'));
  await page.screenshot({ path: `${SHOTS}/slow-3d-suggestion.png` });
  expect(await appMode(page)).toBe('3d'); // nothing switched by itself

  await card.locator('[data-role="switch-2d"]').dispatchEvent('click');
  await settledOn(page, '2d');
  expect(await storedMode(page)).toBe('2d'); // the player chose it
  await expect(page.locator('.modal .headline')).toHaveText('SECURED');
  expect((await snapshot(page)).phase).toBe('won');
  expect(errors).toEqual([]);
  await context.close();
});
