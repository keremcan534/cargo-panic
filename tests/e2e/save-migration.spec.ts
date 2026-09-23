/**
 * A v1 save written by the previous build migrates in the browser: stars,
 * unlocks and the Endless record survive, the v1 key is untouched and a copy
 * is kept aside. The v1 Endless record is kept under ruleset 1 ("previous
 * rules"), never mixed into the current ruleset's records.
 */

import { expect, test } from '@playwright/test';

const V1 = {
  unlocked: 6,
  stars: { 1: 3, 2: 3, 3: 2, 4: 3, 5: 1 },
  bestBalance: { 1: 0, 2: 0.5, 3: 1, 4: 0, 5: 2 },
  sound: false,
  haptics: true,
  endless: { bestScore: 4321, bestWave: 9, runs: 3 },
};

test('v1 progress survives the move to save v2', async ({ page }) => {
  await page.addInitScript((v1) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.clear();
      localStorage.setItem('cargo-panic.save.v1', JSON.stringify(v1));
      sessionStorage.setItem('seeded', '1');
    }
  }, V1);
  await page.goto('/');
  await expect(page.locator('[data-role="play"]')).toBeVisible();
  await expect(page.locator('.menu .chip')).toContainText('★ 12 / 75');
  await expect(page.locator('.menu .chip')).toContainText('5 / 25');
  // The v1 Endless best is shown apart, as a previous-rules record; no current-ruleset run yet.
  await expect(page.locator('.menu [data-role="endless-previous"]')).toHaveText('PREVIOUS RULES: BEST 4,321 - WAVE 9');
  await expect(page.locator('.menu .caption').first()).toHaveText('PROCEDURAL WAVES - ONE MISTAKE ENDS A RUN');

  const stored = await page.evaluate(() => ({
    v1: localStorage.getItem('cargo-panic.save.v1'),
    v1Backup: localStorage.getItem('cargo-panic.save.v1.backup'),
    v2: localStorage.getItem('cargo-panic.save.v2'),
  }));
  expect(stored.v1).toBe(JSON.stringify(V1));
  expect(stored.v1Backup).toBe(JSON.stringify(V1));
  const v2 = JSON.parse(stored.v2 ?? '{}');
  expect(v2.v).toBe(2);
  expect(v2.data.campaign.unlocked).toBe(6);
  expect(v2.data.campaign.stars).toEqual({ 1: 3, 2: 3, 3: 2, 4: 3, 5: 1 });
  expect(v2.data.settings.sound).toBe(false);
  expect(v2.data.endless['1']).toEqual(V1.endless);
  expect(v2.data.endless['2']).toBeUndefined();

  // Reload: now read from v2, same numbers.
  await page.reload();
  await expect(page.locator('.menu .chip')).toContainText('★ 12 / 75');
  await page.locator('[data-role="levels"]').click();
  await expect(page.locator('.grid .tile:not(.locked)')).toHaveCount(6);
});
