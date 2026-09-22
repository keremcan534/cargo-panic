/**
 * Switching between the 2D and 3D views from the pause panel, in the
 * production build with real pointer input:
 *
 * - mid-drag: the package in hand goes back where the session has it, the
 *   session (placements, queue, clocks, assists) is untouched by the
 *   switch, the late pointerup does nothing, and the package is still there
 *   to be picked up in the new view;
 * - twenty switches leave exactly one canvas, one requestAnimationFrame
 *   chain, the same FrameLoop subscribers, the same 3D GPU resource counts
 *   and the same session;
 * - level 25 drawn in 3D, then in 2D after a switch.
 *
 * Headless desktop Chromium + SwiftShader: functional checks, not device
 * performance. Screenshots: test-results/a2b/.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  Hand,
  bootToMenu,
  frames,
  gameMode,
  openWithSave,
  pause,
  pickView,
  pointOf,
  rules,
  settledOn,
  snapshot,
  startLevel,
} from './support/game';
import { v2Save } from './support/save';

const SHOTS = 'test-results/a2b';

const pauseReasons = (page: Page) => page.evaluate(() => window.__cargoPanic!.pauseReasons);
const canvases = (page: Page) => page.evaluate(() => document.querySelectorAll('canvas').length);

/** Clicks a view in the open pause panel and reports, in the same task, whether the panel locked itself. */
function clickViewAndReadLock(page: Page, mode: '2d' | '3d') {
  return page.evaluate((m) => {
    (document.querySelector(`[data-role="view"] [data-value="${m}"]`) as HTMLButtonElement).click();
    const disabled = (role: string) => (document.querySelector(`[data-role="${role}"]`) as HTMLButtonElement).disabled;
    const toggles = [...document.querySelectorAll<HTMLButtonElement>('[data-role="view"] button')].map((b) => b.disabled);
    return { resume: disabled('resume'), exit: disabled('exit'), restart: disabled('restart'), toggles };
  }, mode);
}

test('switching view mid-drag loses and duplicates nothing and keeps the session', async ({ browser, baseURL }) => {
  test.setTimeout(600_000);
  const save = v2Save((d) => {
    d.settings.renderMode = '2d';
  });
  const { context, page, errors } = await openWithSave(browser, baseURL, save);
  await bootToMenu(page);
  await startLevel(page, 8);
  const hand = new Hand(page);
  await hand.drag(0, { shelf: 0, slot: 2, slots: 1 }); // fragile
  await hand.drag(1, { shelf: 0, slot: 1, slots: 1 }); // heavy
  await expect.poll(async () => (await snapshot(page)).placements.length).toBe(2);
  const committed = await snapshot(page);

  // Pick the stowed heavy crate up again and hold it over another slot - no release.
  await hand.grab(1);
  await hand.aim({ shelf: 1, slot: 2, slots: 1 });
  expect(await page.evaluate(() => window.__cargoPanic!.board().held)).toBe(1);
  expect((await snapshot(page)).placements).toEqual(committed.placements); // holding changes nothing
  await page.screenshot({ path: `${SHOTS}/2d-mid-drag.png` });

  // Escape opens pause while the button is still down: the crate goes back, the session pauses.
  await pause(page);
  expect(await page.evaluate(() => window.__cargoPanic!.board().held)).toBeNull();
  expect(await pauseReasons(page)).toEqual(['menu']);
  const paused = await rules(page);
  expect((await snapshot(page)).phase).toBe('paused');
  expect(paused.placements).toEqual(committed.placements);
  expect(paused.queue).toEqual(committed.queue);

  // Switch to 3D; the panel locks itself for the duration.
  const lock = await clickViewAndReadLock(page, '3d');
  expect(lock).toEqual({ resume: true, exit: true, restart: true, toggles: [true, true] });
  await settledOn(page, '3d');
  expect(await gameMode(page)).toBe('3d');
  await expect(page.locator('[data-role="resume"]')).toBeEnabled();
  expect(await rules(page)).toEqual(paused); // placements, queue, clocks, assists: all untouched
  expect(await pauseReasons(page)).toEqual(['menu']);
  expect(await canvases(page)).toBe(1);

  // The late pointerup of the interrupted drag commits nothing.
  await page.mouse.up();
  await frames(page, 2);
  expect(await rules(page)).toEqual(paused);

  await page.locator('[data-role="resume"]').dispatchEvent('click');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('play');
  expect(await pauseReasons(page)).toEqual([]);

  // The crate is on its shelf in the 3D view and can be moved once: no loss, no copy.
  await frames(page, 2);
  const at = await pointOf(page, { cargo: 1 });
  const slot = await pointOf(page, { shelf: 0, slot: 1, slots: 1 });
  expect(Math.abs(at.x - slot.x)).toBeLessThan(30);
  const hand3d = new Hand(page);
  await hand3d.drag(1, { shelf: 0, slot: 3, slots: 1 });
  await expect.poll(async () => (await snapshot(page)).placements).toEqual([
    { id: 0, type: 'fragile', shelf: 0, slot: 2 },
    { id: 1, type: 'heavy', shelf: 0, slot: 3 },
  ]);
  const after = await snapshot(page);
  expect(after.queue).toEqual(committed.queue);
  expect(after.rejectedDrops).toBe(committed.rejectedDrops);
  await frames(page, 4);
  await page.screenshot({ path: `${SHOTS}/3d-after-mid-drag-switch.png` });
  expect(errors).toEqual([]);
  await context.close();
});

/** Counts pending requestAnimationFrame callbacks and callbacks run (init script). */
function countAnimationFrames() {
  const w = window as unknown as { __raf: { pending: Set<number>; fired: number } };
  w.__raf = { pending: new Set(), fired: 0 };
  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = raf((t) => {
      w.__raf.pending.delete(id);
      w.__raf.fired++;
      cb(t);
    });
    w.__raf.pending.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id: number) => {
    w.__raf.pending.delete(id);
    caf(id);
  };
}

test('20 view switches: one canvas, one draw loop, same subscribers, same GPU counts, same session', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(900_000);
  const save = v2Save((d) => {
    d.settings.renderMode = '2d';
  });
  const { context, page, errors } = await openWithSave(browser, baseURL, save, countAnimationFrames);
  await bootToMenu(page);
  await startLevel(page, 15);
  const hand = new Hand(page);
  await hand.drag(0, { shelf: 0, slot: 2, slots: 3 }); // long
  await hand.drag(1, { shelf: 2, slot: 2, slots: 1 });
  await expect.poll(async () => (await snapshot(page)).placements.length).toBe(2);

  await pause(page);
  await frames(page, 5);
  await page.screenshot({ path: `${SHOTS}/2d-pause-view-toggle.png` });
  const subscribers = await page.evaluate(() => window.__cargoPanic!.loopSubscribers);
  const before = await snapshot(page);

  type Gpu = Record<string, number | string>;
  const gpu = () => page.evaluate(() => window.__cargoPanicGpu!()) as Promise<Gpu>;
  const gpuSeen: Gpu[] = [];
  const times: number[] = [];
  for (let i = 0; i < 20; i++) {
    const to = i % 2 === 0 ? '3d' : '2d';
    const t0 = Date.now();
    if (i === 0) {
      expect(await clickViewAndReadLock(page, to)).toEqual({ resume: true, exit: true, restart: true, toggles: [true, true] });
      await settledOn(page, to);
    } else {
      await pickView(page, to);
    }
    times.push(Date.now() - t0);
    expect(await canvases(page)).toBe(1);
    if (to === '3d') {
      await frames(page, 3);
      gpuSeen.push(await gpu());
      if (i === 0) await page.screenshot({ path: `${SHOTS}/3d-pause-view-toggle.png` });
    }
  }
  console.log(`[20 switches] ms per switch: ${times.join(', ')}`);
  console.log(`[20 switches] 3D GPU counts: first ${JSON.stringify(gpuSeen[0])} last ${JSON.stringify(gpuSeen[gpuSeen.length - 1])}`);

  expect(await gameMode(page)).toBe('2d');
  expect(await page.locator('#game-canvas').count()).toBe(1);
  expect(await canvases(page)).toBe(1);
  expect(await page.evaluate(() => window.__cargoPanic!.loopSubscribers)).toBe(subscribers);
  expect(await snapshot(page)).toEqual(before);
  for (const g of gpuSeen) {
    expect({ geometries: g.geometries, textures: g.textures, sceneChildren: g.sceneChildren }).toEqual({
      geometries: gpuSeen[0].geometries,
      textures: gpuSeen[0].textures,
      sceneChildren: gpuSeen[0].sceneChildren,
    });
  }

  // One requestAnimationFrame chain: never more than one callback pending, one callback per loop frame.
  const raf = await page.evaluate(async () => {
    const w = window as unknown as { __raf: { pending: Set<number>; fired: number } };
    const fired0 = w.__raf.fired;
    const frames0 = window.__cargoPanicApp!.frames;
    let maxPending = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 2000) {
      maxPending = Math.max(maxPending, w.__raf.pending.size);
      await new Promise((r) => setTimeout(r, 10));
    }
    return { maxPending, fired: w.__raf.fired - fired0, frames: window.__cargoPanicApp!.frames - frames0 };
  });
  console.log(`[20 switches] rAF over 2 s: ${JSON.stringify(raf)}`);
  expect(raf.maxPending).toBe(1);
  expect(raf.frames).toBeGreaterThan(10);
  expect(raf.fired).toBe(raf.frames);

  // Still the same game: resume and carry on.
  await page.locator('[data-role="resume"]').dispatchEvent('click');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('play');
  await hand.drag(2, { shelf: 1, slot: 2, slots: 1 });
  await expect.poll(async () => (await snapshot(page)).placements.length).toBe(3);
  expect(errors).toEqual([]);
  await context.close();
});

test('level 25 in 3D, then the same board in 2D after a switch', async ({ browser, baseURL }) => {
  test.setTimeout(600_000);
  const save = v2Save((d) => {
    d.settings.renderMode = '3d';
  });
  const { context, page, errors } = await openWithSave(browser, baseURL, save);
  await bootToMenu(page);
  await startLevel(page, 25);
  expect(await gameMode(page)).toBe('3d');
  const hand = new Hand(page);
  await hand.drag(0, { shelf: 3, slot: 1, slots: 3 });
  await expect.poll(async () => (await snapshot(page)).placements).toEqual([{ id: 0, type: 'long', shelf: 3, slot: 1 }]);
  await frames(page, 6);
  await page.screenshot({ path: `${SHOTS}/3d-level25.png` });

  await pause(page);
  const paused = await rules(page);
  await pickView(page, '2d');
  expect(await rules(page)).toEqual(paused);
  await page.locator('[data-role="resume"]').dispatchEvent('click');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('play');
  await frames(page, 30);
  await page.screenshot({ path: `${SHOTS}/2d-level25-after-switch.png` });
  expect(errors).toEqual([]);
  await context.close();
});
