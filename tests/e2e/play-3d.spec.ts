/**
 * The 3D game driven with real pointer events (mouse) at positions the game
 * reports through its `?e2e` test hook. Functional checks in headless
 * Chromium (SwiftShader WebGL) - not a device or performance measurement.
 *
 * Screenshots land in test-results/a1/ (not committed).
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { getWave } from '../../src/game/levels/generator';
import { PACKAGE_SPECS } from '../../src/game/levels/types';

type Target = { cargo: number } | { shelf: number; slot: number; slots: number } | { belt: true };

const SHOTS = 'test-results/a1';

// Read-only probes into the running game (window.__cargoPanic, see src/app/Game.ts).
const snapshot = (page: Page) => page.evaluate(() => window.__cargoPanic!.snapshot());
const held = (page: Page) => page.evaluate(() => window.__cargoPanic!.board().held);
const placements = (page: Page) => page.evaluate(() => window.__cargoPanic!.snapshot().placements);

async function pointOf(page: Page, t: Target) {
  const p = await page.evaluate((target) => window.__cargoPanic!.clientPointOf(target), t);
  expect(p, `client point of ${JSON.stringify(t)}`).not.toBeNull();
  return p!;
}

/**
 * Chromium delivers pointermove aligned to animation frames, and headless
 * SwiftShader can run at ~1-2 fps here, so every extra move costs a frame of
 * game time. Moves are single steps and repeated only when the target moved.
 */
let last = { x: -1, y: -1 };
async function moveTo(page: Page, p: { x: number; y: number }) {
  if (Math.abs(p.x - last.x) < 0.5 && Math.abs(p.y - last.y) < 0.5) return;
  last = { x: p.x, y: p.y };
  await page.mouse.move(p.x, p.y);
}

/** Presses on a package until the game reports it in hand (it may still be sliding along the belt). */
async function grab(page: Page, cargo: number) {
  await expect
    .poll(
      async () => {
        await moveTo(page, await pointOf(page, { cargo }));
        await page.mouse.down();
        if ((await held(page)) === cargo) return true;
        await page.mouse.up();
        return false;
      },
      { timeout: 45_000, intervals: [200, 300, 500] },
    )
    .toBe(true);
}

const sameTarget = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Moves the held package over a slot and keeps the pointer on that slot's
 * reported position until the game shows it as the drop target (the drag
 * plane eases in per frame), so this waits on what the game shows rather
 * than on wall time.
 */
async function aim(page: Page, t: { shelf: number; slot: number; slots: number }) {
  const want = { kind: 'slot', shelf: t.shelf, slot: t.slot };
  await expect
    .poll(
      async () => {
        await moveTo(page, await pointOf(page, t));
        return sameTarget(await page.evaluate(() => window.__cargoPanic!.aimed()), want);
      },
      { timeout: 45_000, intervals: [100, 150, 250] },
    )
    .toBe(true);
}

/** Waits until the game loop has drawn `n` more frames. */
async function frames(page: Page, n: number) {
  const count = () =>
    page.evaluate(() => (window as unknown as { __cargoPanicGpu: () => { frames: number } }).__cargoPanicGpu().frames);
  const start = await count();
  await expect.poll(count, { timeout: 60_000 }).toBeGreaterThanOrEqual(start + n);
}

async function dragTo(page: Page, cargo: number, t: { shelf: number; slot: number; slots: number }) {
  await grab(page, cargo);
  await aim(page, t);
  await page.mouse.up();
}

async function startLevel(page: Page, id: number) {
  await page.addInitScript((unlocked) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'cargo-panic.save.v1',
      JSON.stringify({ unlocked, stars: {}, bestBalance: {}, sound: false, haptics: false }),
    );
    sessionStorage.setItem('seeded', '1');
  }, id);
  await page.goto('/?e2e');
  await page.locator('[data-role="levels"]').dispatchEvent('click');
  await page.locator(`[data-level="${id}"]`).dispatchEvent('click');
  await page.waitForFunction(() => !!window.__cargoPanic);
  await expect(page.locator('.hud .title')).toHaveText(`LEVEL ${id}`);
  await frames(page, 3);
}

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  last = { x: -1, y: -1 };
  page.on('pageerror', (e) => pageErrors.push(e.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test('plays campaign level 1 to the win panel with real pointer drags', async ({ page }) => {
  test.slow();
  await page.goto('/?e2e');
  await page.locator('[data-role="play"]').dispatchEvent('click');
  await page.waitForFunction(() => !!window.__cargoPanic);
  await expect(page.locator('.hud .title')).toHaveText('LEVEL 1');
  expect(await page.evaluate(() => window.__cargoPanic!.mode)).toBe('3d');
  await frames(page, 3);

  // Picking up changes nothing in the rules: the box is held, the belt does not advance.
  await grab(page, 0);
  expect(await held(page)).toBe(0);
  expect((await snapshot(page)).queue).toEqual([0, 1]);
  await aim(page, { shelf: 0, slot: 1, slots: 1 });
  expect(await placements(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/level1-drag.png` });
  await page.mouse.up();

  await expect.poll(() => placements(page)).toEqual([
    { id: 0, type: 'standard', shelf: 0, slot: 1 },
  ]);
  expect((await snapshot(page)).queue).toEqual([1]);
  await expect(page.locator('.hud .remaining')).toHaveText('1 / 2 LEFT');
  await frames(page, 10); // landing and belt slide finish
  await page.screenshot({ path: `${SHOTS}/level1-midplay.png` });

  await dragTo(page, 1, { shelf: 0, slot: 3, slots: 1 });
  await expect(page.locator('.modal .headline')).toHaveText('SECURED');
  const snap = await snapshot(page);
  expect(snap.phase).toBe('won');
  expect(snap.outcome?.imbalance).toBe(0);
  await expect(page.locator('.modal .star:not(.off)')).toHaveCount(3);
  await page.screenshot({ path: `${SHOTS}/level1-won.png` });
});

test('level 25 renders every tier and places a long package', async ({ page }) => {
  test.slow();
  await startLevel(page, 25);
  expect(await page.evaluate(() => window.__cargoPanic!.board().level.shelves.length)).toBe(4);
  await page.screenshot({ path: `${SHOTS}/level25-start.png` });

  await grab(page, 0);
  await aim(page, { shelf: 1, slot: 2, slots: 3 });
  await page.screenshot({ path: `${SHOTS}/level25-drag-long.png` });
  await page.mouse.up();
  await expect.poll(() => placements(page)).toEqual([
    { id: 0, type: 'long', shelf: 1, slot: 2 },
  ]);
  await frames(page, 10);
  await page.screenshot({ path: `${SHOTS}/level25-midplay.png` });
});

test('level 4: the hazard clock keeps running while the offending crate is held', async ({ page }) => {
  test.slow();
  await startLevel(page, 4);
  await dragTo(page, 0, { shelf: 0, slot: 4, slots: 1 });
  const banner = page.locator('.hazard.on');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('RACK TIPPING');

  // Pick the heavy crate back up and hold it well clear of the rack.
  await grab(page, 0);
  const above = await pointOf(page, { shelf: 0, slot: 2, slots: 1 });
  await moveTo(page, { x: above.x, y: above.y - 220 });
  expect(await held(page)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__cargoPanic!.aimed()), { timeout: 30_000 }).toBeNull();

  // One atomic read of what the player sees and what the rules hold.
  const sample = () =>
    page.evaluate(() => {
      const h = window.__cargoPanic!;
      const snap = h.snapshot();
      const banner = document.querySelector('.hazard.on')?.textContent ?? '';
      const secs = /([\d.]+)s/.exec(banner);
      return {
        held: h.board().held,
        phase: snap.phase,
        clock: snap.hazards.balance,
        banner: secs ? Number(secs[1]) : null,
        placements: JSON.stringify(snap.placements),
      };
    });
  const s1 = await sample();
  expect(s1).toMatchObject({ held: 0, phase: 'play' });
  expect(s1.banner).not.toBeNull();
  await page.screenshot({ path: `${SHOTS}/level4-held-hazard.png` });
  // Later, with the same crate still in hand and the committed board unchanged,
  // the on-screen countdown and the rules clock have both kept draining.
  await expect
    .poll(
      async () => {
        const s = await sample();
        return (
          s.held === 0 &&
          s.phase === 'play' &&
          s.placements === s1.placements &&
          s.clock < s1.clock - 300 &&
          s.banner !== null &&
          s.banner < (s1.banner as number)
        );
      },
      { timeout: 30_000, intervals: [100, 150, 250] },
    )
    .toBe(true);
  expect(JSON.parse(s1.placements)).toEqual([{ id: 0, type: 'heavy', shelf: 0, slot: 4 }]);

  // Still holding when the grace period runs out: the rack goes over.
  await expect(page.locator('.modal .headline')).toHaveText('RACK COLLAPSED', { timeout: 60_000 });
  expect((await snapshot(page)).phase).toBe('failed');
  expect(await held(page)).toBeNull();
  await page.mouse.up(); // ignored: the shipment is over
  await frames(page, 2);
  await expect(page.locator('.modal .headline')).toHaveText('RACK COLLAPSED');
  expect(await placements(page)).toEqual([{ id: 0, type: 'heavy', shelf: 0, slot: 4 }]);
});

test('level 4: only a committed move clears the countdown', async ({ page }) => {
  test.slow();
  await startLevel(page, 4);
  await dragTo(page, 0, { shelf: 0, slot: 4, slots: 1 });
  await expect(page.locator('.hazard.on')).toBeVisible();
  await dragTo(page, 0, { shelf: 0, slot: 2, slots: 1 });
  await expect(page.locator('.hazard.on')).toHaveCount(0);
  expect(await placements(page)).toEqual([{ id: 0, type: 'heavy', shelf: 0, slot: 2 }]);
  expect((await snapshot(page)).phase).toBe('play');
});

test('opening pause mid-drag puts the package back and stops the clocks', async ({ page }) => {
  test.slow();
  await startLevel(page, 4);
  await dragTo(page, 0, { shelf: 0, slot: 4, slots: 1 });
  await expect(page.locator('.hazard.on')).toBeVisible();

  // Aim the fix, but open PAUSE (a second finger) before letting go.
  await grab(page, 0);
  await aim(page, { shelf: 0, slot: 2, slots: 1 });
  await page.locator('[data-icon="pause"]').dispatchEvent('click');
  await expect(page.locator('.modal .headline')).toHaveText('PAUSED');
  const paused = await snapshot(page);
  expect(paused.phase).toBe('paused');
  expect(await held(page)).toBeNull();
  expect(paused.placements).toEqual([{ id: 0, type: 'heavy', shelf: 0, slot: 4 }]);

  // Nothing drains while paused, and the late pointerup changes nothing.
  await frames(page, 4);
  await page.mouse.up();
  await frames(page, 2);
  const still = await snapshot(page);
  expect(still.hazards.balance).toBe(paused.hazards.balance);
  expect(still.activeMs).toBe(paused.activeMs);
  expect(still.placements).toEqual(paused.placements);

  await page.locator('[data-role="resume"]').dispatchEvent('click');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('play');
  await expect.poll(async () => (await snapshot(page)).hazards.balance, { timeout: 30_000 }).toBeLessThan(
    paused.hazards.balance,
  );
});

test('endless: a cleared wave is dispatched, scored once and the next wave deals', async ({ page }) => {
  test.slow();
  const plan = getWave(12345, 1);
  await page.goto('/?e2e&seed=12345');
  await page.locator('[data-role="endless"]').dispatchEvent('click');
  await page.waitForFunction(() => !!window.__cargoPanic);
  await expect(page.locator('.hud .title')).toHaveText('WAVE 1');
  expect((await snapshot(page)).source).toMatchObject({ mode: 'endless', seed: 12345, wave: 1 });
  await frames(page, 3);

  // The solver-proved arrangement, in conveyor order, never goes red.
  for (const p of plan.solution) {
    await dragTo(page, p.id, { shelf: p.shelf, slot: p.slot, slots: PACKAGE_SPECS[p.type].slots });
  }
  const card = page.locator('.wave-card');
  await expect(card).toContainText('SHIPMENT DISPATCHED', { timeout: 30_000 });
  const total = Number(((await card.locator('.total').innerText()) || '').replace(/[^0-9]/g, ''));
  expect(total).toBeGreaterThan(0);
  await expect(page.locator('.hud .subtitle')).toHaveText(total.toLocaleString('en-US'));
  await page.screenshot({ path: `${SHOTS}/endless-dispatch.png` });

  await expect(page.locator('.hud .title')).toHaveText('WAVE 2', { timeout: 60_000 });
  expect((await snapshot(page)).source).toMatchObject({ mode: 'endless', seed: 12345, wave: 2 });
  await expect(page.locator('.hud .subtitle')).toHaveText(total.toLocaleString('en-US'));
});

test('restarting a level and switching screens does not grow GPU resources', async ({ page }) => {
  test.slow();
  const gpu = () =>
    page.evaluate(() =>
      (window as unknown as { __cargoPanicGpu: () => Record<string, number> }).__cargoPanicGpu(),
    );
  await startLevel(page, 1);
  const restart = async () => {
    await page.evaluate(() => {
      (window as unknown as { __prevHook: unknown }).__prevHook = window.__cargoPanic;
    });
    await page.locator('[data-icon="restart"]').dispatchEvent('click');
    await page.waitForFunction(
      () => !!window.__cargoPanic && window.__cargoPanic !== (window as unknown as { __prevHook: unknown }).__prevHook,
    );
    await frames(page, 3);
  };
  await restart();
  const first = await gpu();
  for (let i = 0; i < 4; i++) await restart();
  const later = await gpu();
  test.info().annotations.push({ type: 'gpu-restart', description: `${JSON.stringify(first)} -> ${JSON.stringify(later)}` });
  expect(later.geometries).toBe(first.geometries);
  expect(later.textures).toBe(first.textures);
  expect(later.sceneChildren).toBe(first.sceneChildren);

  // Menu <-> level select backdrops.
  await page.goto('/?e2e');
  await expect(page.locator('.menu [data-role="levels"]')).toBeVisible({ timeout: 60_000 });
  const cycle = async () => {
    await page.locator('.menu [data-role="levels"]').dispatchEvent('click');
    await expect(page.locator('.screen.levels')).toHaveCount(1);
    await frames(page, 2);
    await page.locator('.screen.levels [data-icon="back"]').dispatchEvent('click');
    await expect(page.locator('.screen.menu')).toHaveCount(1);
    await frames(page, 2);
  };
  await cycle();
  const menu1 = await gpu();
  for (let i = 0; i < 3; i++) await cycle();
  const menu2 = await gpu();
  test.info().annotations.push({ type: 'gpu-menu', description: `${JSON.stringify(menu1)} -> ${JSON.stringify(menu2)}` });
  expect(menu2.geometries).toBe(menu1.geometries);
  expect(menu2.textures).toBe(menu1.textures);
  expect(menu2.sceneChildren).toBe(menu1.sceneChildren);
});
