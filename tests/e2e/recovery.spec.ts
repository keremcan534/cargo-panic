/**
 * Recovery from an unexpected error in the real game (2D): an error thrown
 * from the game's own code inside a frame callback in the middle of a level
 * brings the player back to the main menu with the notice; the frame loop
 * keeps drawing; the save keeps its progress and the game in progress
 * (CONTINUE brings it back with the same board). An error on the menu, and
 * an unhandled rejection, keep the menu working.
 *
 * The errors are raised through the `?e2e` probe (window.__cargoPanicApp
 * .throwIn), so they come from the game's bundle like a real bug would.
 * Headless desktop Chromium with a phone viewport: functional checks only.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { bootToMenu, frames, openWithSave, rules, selectCargo, snapshot, startLevel, storedSave, tapTarget } from './support/game';
import { saveData, v2Save } from './support/save';

const NOTICE = 'Something went wrong. The game recovered and your progress is safe.';

const save = () =>
  v2Save((d) => {
    d.settings.renderMode = '2d';
    d.tutorial.skipped = true;
    d.tutorial.seenCargo = ['heavy', 'fragile', 'long', 'priority'];
  }, 6);

const stored = async (page: Page) => saveData(await storedSave(page));

test('an error inside the game brings back the menu with a notice; progress and the game in progress are kept', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, save(), undefined, {
    viewport: { width: 360, height: 640 },
  });
  await bootToMenu(page);
  await startLevel(page, 2);
  await selectCargo(page, 0);
  await tapTarget(page, { shelf: 0, slot: 0, slots: 1 });
  await expect.poll(async () => (await snapshot(page)).placements.length).toBe(1);
  const board = await rules(page);

  await page.evaluate(() => window.__cargoPanicApp!.throwIn('frame'));

  await expect(page.locator('.menu [data-role="play"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.notice')).toHaveText(NOTICE);
  await expect.poll(() => page.evaluate(() => !!window.__cargoPanic)).toBe(false);
  // Caught by the frame loop and handed to the recovery: it never became an uncaught page error.
  expect(errors).toEqual([]);
  // The loop did not die with the error.
  await frames(page, 5);

  // Progress written and intact: the unlocked levels, and the game in progress with its move.
  const data = await stored(page);
  expect(data?.campaign.unlocked).toBe(6);
  expect(data?.active?.kind).toBe('campaign');
  await page.screenshot({ path: 'test-results/recovery/menu-after-error.png' });

  // CONTINUE brings that game back, paused, with the same board.
  const cont = page.locator('.menu [data-role="continue"]');
  await expect(cont).toHaveText('CONTINUE - LEVEL 2');
  await cont.dispatchEvent('click');
  await page.waitForFunction(() => !!window.__cargoPanic);
  await expect.poll(async () => (await snapshot(page)).phase).toBe('paused');
  expect((await rules(page)).placements).toEqual(board.placements);
  await context.close();
});

test('an error or an unhandled rejection on the menu leaves the menu working', async ({ browser, baseURL }) => {
  const { context, page, errors } = await openWithSave(browser, baseURL, save(), undefined, {
    viewport: { width: 360, height: 640 },
  });
  await bootToMenu(page);
  await page.evaluate(() => window.__cargoPanicApp!.throwIn('task'));
  await expect(page.locator('.notice')).toHaveText(NOTICE);
  await expect(page.locator('.menu [data-role="play"]')).toBeVisible();
  await page.waitForTimeout(1_200); // past the burst window, so the rejection is a recovery of its own
  await page.evaluate(() => window.__cargoPanicApp!.throwIn('promise'));
  await expect(page.locator('.menu [data-role="play"]')).toBeVisible();
  await frames(page, 5);
  // Still usable: level select opens.
  await page.locator('.menu [data-role="levels"]').dispatchEvent('click');
  await expect(page.locator('[data-level="1"]')).toBeVisible({ timeout: 30_000 });
  // Only the two thrown on purpose reached the page.
  expect(errors.every((m) => m.startsWith('e2e: thrown in a'))).toBe(true);
  expect((await stored(page))?.campaign.unlocked).toBe(6);
  await context.close();
});
