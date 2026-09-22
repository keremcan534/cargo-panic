/**
 * Helpers for driving the real game in the browser with real pointer input
 * (mouse) at positions the game reports through its `?e2e` probes:
 * window.__cargoPanic (the game screen) and window.__cargoPanicApp (the app).
 *
 * Everything waits on what the game shows or reports (held package, aimed
 * target, frames drawn, busy flag), never on fixed sleeps: headless
 * SwiftShader draws 3D at ~1-2 fps here, 2D much faster.
 */

import { devices, expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { SAVE_KEY } from './save';

export type Target = { cargo: number } | { shelf: number; slot: number; slots: number } | { belt: true };
export type Spot = { shelf: number; slot: number };

/** A new phone-sized context (same device as the config) whose localStorage starts with `save`. */
export async function openWithSave(
  browser: Browser,
  baseURL: string | undefined,
  save: string | null,
  init?: () => void,
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL });
  await context.addInitScript(
    ([key, raw]) => {
      if (sessionStorage.getItem('seeded')) return;
      localStorage.clear();
      if (raw !== null) localStorage.setItem(key, raw);
      sessionStorage.setItem('seeded', '1');
    },
    [SAVE_KEY, save] as const,
  );
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, errors };
}

// --- probes -----------------------------------------------------------------

export const snapshot = (page: Page) => page.evaluate(() => window.__cargoPanic!.snapshot());
export const held = (page: Page) => page.evaluate(() => window.__cargoPanic!.board().held);
export const gameMode = (page: Page) => page.evaluate(() => window.__cargoPanic!.mode);
export const appMode = (page: Page) => page.evaluate(() => window.__cargoPanicApp!.mode);
export const storedSave = (page: Page) => page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);

/** The rules state a view switch must never touch (everything but the phase). */
export async function rules(page: Page) {
  const s = await snapshot(page);
  return {
    placements: s.placements,
    queue: s.queue,
    hazards: s.hazards,
    activeMs: s.activeMs,
    dangerMs: s.dangerMs,
    winSettleMs: s.winSettleMs,
    assists: s.assists,
    rejectedDrops: s.rejectedDrops,
    undoLeft: s.undoLeft,
    source: s.source,
  };
}

export async function pointOf(page: Page, t: Target) {
  const p = await page.evaluate((target) => window.__cargoPanic!.clientPointOf(target), t);
  expect(p, `client point of ${JSON.stringify(t)}`).not.toBeNull();
  return p!;
}

/** Waits until the app loop has drawn `n` more frames. */
export async function frames(page: Page, n: number) {
  const count = () => page.evaluate(() => window.__cargoPanicApp!.frames);
  const start = await count();
  await expect.poll(count, { timeout: 90_000 }).toBeGreaterThanOrEqual(start + n);
}

/** Waits for the stage host to be idle with `mode` drawing. */
export async function settledOn(page: Page, mode: '2d' | '3d') {
  await expect
    .poll(() => page.evaluate(() => ({ mode: window.__cargoPanicApp!.mode, busy: window.__cargoPanicApp!.busy })), {
      timeout: 90_000,
    })
    .toEqual({ mode, busy: false });
}

// --- pointer ------------------------------------------------------------------

/**
 * Chromium delivers pointermove aligned to animation frames; in slow 3D
 * every extra move costs a frame, so moves are single steps and repeated
 * only when the target moved.
 */
export class Hand {
  private last = { x: -1, y: -1 };
  private holding: number | null = null;
  constructor(private page: Page) {}

  async moveTo(p: { x: number; y: number }) {
    if (Math.abs(p.x - this.last.x) < 0.5 && Math.abs(p.y - this.last.y) < 0.5) return;
    this.last = { x: p.x, y: p.y };
    await this.page.mouse.move(p.x, p.y);
  }

  /** Presses on a package until the game reports it in hand (it may still be sliding along the belt). */
  async grab(cargo: number) {
    const page = this.page;
    await expect
      .poll(
        async () => {
          await this.moveTo(await pointOf(page, { cargo }));
          await page.mouse.down();
          if ((await held(page)) === cargo) return true;
          await page.mouse.up();
          return false;
        },
        { timeout: 60_000, intervals: [100, 200, 300, 500] },
      )
      .toBe(true);
    this.holding = cargo;
  }

  /**
   * Moves the package in hand - not the pointer - over the target, the way a
   * player does: the pointer goes to the target minus the offset between the
   * drawn package and the pointer (a grab off-centre, or on a package still
   * sliding in), until the game shows the target as the drop target.
   */
  async aim(t: { shelf: number; slot: number; slots: number } | { belt: true }) {
    const page = this.page;
    const cargo = this.holding;
    if (cargo === null) throw new Error('aim() without a package in hand');
    const want = JSON.stringify('belt' in t ? { kind: 'belt' } : { kind: 'slot', shelf: t.shelf, slot: t.slot });
    const aimed = async () => JSON.stringify(await page.evaluate(() => window.__cargoPanic!.aimed()));
    const deadline = Date.now() + 60_000;
    let seen = '';
    while (Date.now() < deadline) {
      seen = await aimed();
      if (seen === want) return;
      const target = await pointOf(page, t);
      const drawn = await pointOf(page, { cargo });
      const off = this.last.x < 0 ? { x: 0, y: 0 } : { x: drawn.x - this.last.x, y: drawn.y - this.last.y };
      await this.moveTo({ x: target.x - off.x, y: target.y - off.y });
      await frames(page, 2); // the view moves the package, then the controller re-reads its target
    }
    throw new Error(`aim ${JSON.stringify(t)}: the game kept showing ${seen}`);
  }

  async release() {
    this.holding = null;
    await this.page.mouse.up();
  }

  async drag(cargo: number, to: { shelf: number; slot: number; slots: number } | { belt: true }) {
    await this.grab(cargo);
    await this.aim(to);
    await this.release();
  }
}

// --- navigation -----------------------------------------------------------------

/** From the menu to a campaign level through the level grid; waits for the game to draw. */
export async function startLevel(page: Page, id: number) {
  await page.locator('.menu [data-role="levels"]').dispatchEvent('click');
  await page.locator(`[data-level="${id}"]`).dispatchEvent('click');
  await expect(page.locator('.hud .title')).toHaveText(`LEVEL ${id}`, { timeout: 60_000 });
  await page.waitForFunction(() => !!window.__cargoPanic);
  await frames(page, 3);
}

export async function bootToMenu(page: Page, query = '') {
  await page.goto(`/?e2e${query}`);
  await expect(page.locator('.menu [data-role="play"]')).toBeVisible({ timeout: 90_000 });
}

/** Opens the pause panel with the Escape key and waits for it. */
export async function pause(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal .headline')).toHaveText('PAUSED');
}

/** Picks a view in whatever panel is open and waits until it is drawing and idle. */
export async function pickView(page: Page, mode: '2d' | '3d', expectMode: '2d' | '3d' = mode) {
  await page.locator(`[data-role="view"] [data-value="${mode}"]`).dispatchEvent('click');
  await settledOn(page, expectMode);
}
