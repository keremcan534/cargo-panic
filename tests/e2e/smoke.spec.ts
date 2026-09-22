/**
 * Boot smoke test: splash -> menu -> level 1 with the HUD up and a canvas
 * mounted. Records which rendering contexts the page created.
 */

import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __contexts: string[] };
    w.__contexts = [];
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      w.__contexts.push(kind);
      return (orig as (...a: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof orig;
  });
});

test('boots to the menu and starts level 1', async ({ page }) => {
  await page.goto('/');
  const play = page.locator('[data-role="play"]');
  await expect(play).toBeVisible();
  await play.click();
  await expect(page.locator('.hud .title')).toHaveText(/1/);
  await expect(page.locator('#game-root canvas')).toHaveCount(1);
  const contexts = await page.evaluate(() => (window as unknown as { __contexts: string[] }).__contexts);
  test.info().annotations.push({ type: 'contexts', description: contexts.join(',') });
});
