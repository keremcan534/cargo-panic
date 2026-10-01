/**
 * The title screen's hero rack never sits under the menu's text or buttons.
 * In 2D and 3D, on a 360 x 640 phone with a saved game in progress (CONTINUE
 * adds a button) and without one, the rack's rect as drawn - reported by the
 * `?e2e` probe window.__cargoPanicApp.heroRect, the projection of its frame,
 * feet and labels - does not intersect the tagline or the button column. The
 * rack may shrink or be hidden to get there; without CONTINUE it is still
 * shown. After a resize the menu measures again and the rack follows.
 *
 * Headless desktop Chromium with a phone viewport: functional checks, not
 * device measurements. 3D is drawn by SwiftShader at ~1-2 fps: everything
 * waits on frames drawn, never on fixed sleeps.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { bootToMenu, frames, openWithSave, settledOn } from './support/game';
import { v2Save } from './support/save';

type Rect = { x: number; y: number; w: number; h: number };

const PHONE = { width: 360, height: 640 };
const TALL = { width: 412, height: 915 };

function save(mode: '2d' | '3d', inProgress: boolean) {
  return v2Save((d) => {
    d.settings.renderMode = mode;
    d.tutorial.skipped = true;
    if (inProgress) {
      d.active = {
        kind: 'endless',
        rulesetVersion: 2,
        generatorVersion: 1,
        run: { runId: 'hero', seed: 12345, wave: 3, score: 1500, stowed: 9, cleanWaves: 1, assisted: false, rewardedThrough: 2 },
        shipment: null,
      };
    }
  }, 1);
}

/** The rack as drawn and the boxes it must stay clear of, all in CSS px. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const box = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    return {
      hero: window.__cargoPanicApp!.heroRect,
      tagline: box('.menu .tagline'),
      bottom: box('.menu .bottom'),
    };
  });
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Waits for a few drawn frames, then checks the rack is clear of the text and buttons. Returns the rack's rect. */
async function expectClear(page: Page, what: string): Promise<Rect | null> {
  await frames(page, 3);
  const l = await layout(page);
  const shown = l.hero ? `rack ${JSON.stringify(l.hero)}` : 'rack hidden';
  expect(l.hero && overlap(l.hero, l.tagline), `${what}: ${shown} vs tagline ${JSON.stringify(l.tagline)}`).toBeFalsy();
  expect(l.hero && overlap(l.hero, l.bottom), `${what}: ${shown} vs buttons ${JSON.stringify(l.bottom)}`).toBeFalsy();
  return l.hero;
}

for (const mode of ['2d', '3d'] as const) {
  test(`${mode}: with CONTINUE on a 360 x 640 phone the hero rack is clear of the tagline and buttons, also after a resize`, async ({
    browser,
    baseURL,
  }) => {
    test.slow();
    const { context, page, errors } = await openWithSave(browser, baseURL, save(mode, true), undefined, { viewport: PHONE });
    await bootToMenu(page);
    await settledOn(page, mode);
    await expect(page.locator('.menu [data-role="continue"]')).toBeVisible();
    await expectClear(page, `${mode} 360x640 CONTINUE`);

    // A taller phone has room for it: shown, and still clear.
    await page.setViewportSize(TALL);
    expect(await expectClear(page, `${mode} resized to 412x915`), 'shown on a tall phone').not.toBeNull();
    await page.setViewportSize(PHONE);
    await expectClear(page, `${mode} back to 360x640`);
    expect(errors).toEqual([]);
    await context.close();
  });

  test(`${mode}: without a saved game the 360 x 640 title still shows the hero rack, clear of the text`, async ({
    browser,
    baseURL,
  }) => {
    test.slow();
    const { context, page, errors } = await openWithSave(browser, baseURL, save(mode, false), undefined, { viewport: PHONE });
    await bootToMenu(page);
    await settledOn(page, mode);
    await expect(page.locator('.menu [data-role="continue"]')).toHaveCount(0);
    expect(await expectClear(page, `${mode} 360x640`), 'shown').not.toBeNull();
    expect(errors).toEqual([]);
    await context.close();
  });
}
