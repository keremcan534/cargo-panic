/**
 * A quick click or a still press on the live belt package never moves it.
 *
 * Review finding (reproduced before the fix): in 3D the package was still
 * easing off the belt when a quick click released it, so it landed on the
 * bottom shelf; in 2D a still touch press did the same once the touch lift
 * floated it up. A press now only aims at anything after the pointer has
 * travelled past the drag slop, in both views.
 *
 * Headless desktop Chromium with a phone viewport: a functional check.
 */

import { expect, test } from '@playwright/test';
import { frames, openWithSave, pointOf, snapshot, startLevel, bootToMenu } from './support/game';
import { v2Save } from './support/save';

for (const mode of ['2d', '3d'] as const) {
  test(`${mode}: a quick click and a still press on the live package change nothing`, async ({ browser, baseURL }) => {
    test.slow();
    const save = v2Save((d) => {
      d.settings.renderMode = mode;
    });
    const { context, page, errors } = await openWithSave(browser, baseURL, save);
    await bootToMenu(page);
    await startLevel(page, 1);
    const before = await snapshot(page);

    const at = await pointOf(page, { cargo: 0 });
    // Quick click.
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.up();
    await frames(page, 4);
    // Still presses released after 1, 2, 3 and 6 drawn frames: the early ones
    // fall inside the window where the package is still easing off the belt.
    for (const n of [1, 2, 3, 6]) {
      await page.mouse.down();
      await frames(page, n);
      await page.mouse.up();
      await frames(page, 3);
    }
    // A touch tap.
    await page.touchscreen.tap(at.x, at.y);
    await frames(page, 4);

    const after = await snapshot(page);
    expect(after.placements).toEqual(before.placements);
    expect(after.queue).toEqual(before.queue);
    expect(after.rejectedDrops).toBe(0);
    expect(errors).toEqual([]);
    await context.close();
  });
}
