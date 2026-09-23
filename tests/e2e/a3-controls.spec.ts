/**
 * A3 controls in the real game: tap-select / tap-drop in both views, one
 * finger at a time, a cancelled touch, the one free undo, and a refused
 * target that costs nothing.
 *
 * Headless desktop Chromium with a phone viewport (Pixel 7, touch enabled):
 * functional checks, not device measurements. Real input: mouse for taps
 * and drags, CDP touch events for the multi-finger and cancel cases.
 * Screenshots: test-results/a3/.
 */

import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { hintFor } from '../../src/game/systems/Solver';
import {
  Hand,
  aimed,
  bootToMenu,
  frames,
  held,
  openWithSave,
  pointOf,
  selectCargo,
  selection,
  snapshot,
  startLevel,
  tapTarget,
} from './support/game';
import { v2Save } from './support/save';

const SHOTS = 'test-results/a3';

const placements = async (page: Page) => (await snapshot(page)).placements;

/** A save that has seen the guide and every cargo type, so no overlay sits over the rack. */
const quietSave = (mode: '2d' | '3d', edit: Parameters<typeof v2Save>[0] = () => undefined) =>
  v2Save((d) => {
    d.settings.renderMode = mode;
    d.tutorial.skipped = true;
    d.tutorial.seenCargo = ['heavy', 'fragile', 'long', 'priority'];
    edit(d);
  });

for (const mode of ['2d', '3d'] as const) {
  test(`${mode}: tap a package, see the target while the finger is down, lift to place exactly there`, async ({
    browser,
    baseURL,
  }) => {
    test.slow();
    const { context, page, errors } = await openWithSave(browser, baseURL, quietSave(mode));
    await bootToMenu(page);
    await startLevel(page, 4);
    const before = await snapshot(page);

    await selectCargo(page, 0);
    // Selecting changes nothing in the rules.
    const selected = await snapshot(page);
    expect(selected.placements).toEqual(before.placements);
    expect(selected.queue).toEqual(before.queue);
    expect(await held(page)).toBe(0);
    await expect(page.locator('[data-role="controls-text"]')).toHaveText('Tap a slot to place it. Tap the box again to cancel.');

    await tapTarget(page, { shelf: 0, slot: 1, slots: 1 }, async () => {
      // Finger down: target and meter preview are up, nothing committed yet.
      await expect(page.locator('.meter .ghost.on')).toHaveCount(1);
      expect(await placements(page)).toEqual([]);
      await frames(page, mode === '3d' ? 2 : 10);
      await page.screenshot({ path: `${SHOTS}/${mode}-tap-selected-ghost.png` });
    });
    await expect.poll(() => placements(page)).toEqual([{ id: 0, type: 'heavy', shelf: 0, slot: 1 }]);
    expect(await selection(page)).toBeNull();
    expect((await snapshot(page)).queue).toEqual([1, 2]);
    expect((await snapshot(page)).rejectedDrops).toBe(0);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test('2d: a refused drop says why and changes nothing; level 1 still earns 3 stars', async ({ browser, baseURL }) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave('2d'));
  await bootToMenu(page);
  await startLevel(page, 1);

  await selectCargo(page, 0);
  await tapTarget(page, { shelf: 0, slot: 1, slots: 1 });
  await expect.poll(() => placements(page)).toEqual([{ id: 0, type: 'standard', shelf: 0, slot: 1 }]);
  await frames(page, 20);

  // Box 1 dragged onto the occupied slot: refused, back on the belt, reason shown.
  const hand = new Hand(page);
  await hand.grab(1);
  await hand.aim({ shelf: 0, slot: 1, slots: 1 });
  await hand.release();
  await expect(page.locator('.toast.bad')).toContainText('NO ROOM THERE');
  expect(await placements(page)).toEqual([{ id: 0, type: 'standard', shelf: 0, slot: 1 }]);
  expect((await snapshot(page)).queue).toEqual([1]);
  expect((await snapshot(page)).rejectedDrops).toBe(1);
  await page.screenshot({ path: `${SHOTS}/2d-refused-drop-toast.png` });

  // Finish level: still three stars, and no help counted.
  await selectCargo(page, 1);
  await tapTarget(page, { shelf: 0, slot: 3, slots: 1 });
  await expect(page.locator('.modal .headline')).toHaveText('SECURED', { timeout: 30_000 });
  const snap = await snapshot(page);
  expect(snap.outcome?.rejectedDrops).toBe(1);
  expect(snap.outcome?.imbalance).toBe(0);
  await expect(page.locator('.modal .star:not(.off)')).toHaveCount(3);
  await expect(page.locator('.modal .stat', { hasText: 'HELP USED' })).toContainText('NONE');
  // The first shipment ends on success with NEXT LEVEL as the main action.
  await expect(page.locator('.modal [data-role="next"]')).toHaveText('NEXT LEVEL');
  await expect(page.locator('.modal [data-role="next"]')).toHaveClass(/primary/);
  expect(errors).toEqual([]);
  await context.close();
});

test('2d: a refused tap target says why and keeps the selection', async ({ browser, baseURL }) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave('2d'));
  await bootToMenu(page);
  await startLevel(page, 19); // the middle shelf is sealed
  const before = await snapshot(page);
  await selectCargo(page, 0);
  const p = await pointOf(page, { shelf: 1, slot: 2, slots: 1 });
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await expect.poll(() => aimed(page), { timeout: 30_000 }).toEqual({ kind: 'slot', shelf: 1, slot: 2 });
  await page.mouse.up();
  await expect(page.locator('.toast.bad')).toContainText('SHELF SEALED');
  const after = await snapshot(page);
  expect(after.placements).toEqual(before.placements);
  expect(after.queue).toEqual(before.queue);
  expect(await selection(page)).toBe(0);
  expect(await held(page)).toBe(0);
  expect(errors).toEqual([]);
  await context.close();
});

test('2d: UNDO takes back the last move once, then shows it is spent', async ({ browser, baseURL }) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave('2d'));
  await bootToMenu(page);
  await startLevel(page, 4);
  const undo = page.locator('[data-role="undo"]');
  await expect(undo).toHaveAttribute('aria-disabled', 'true'); // nothing to undo yet
  const start = await snapshot(page);

  await selectCargo(page, 0);
  await tapTarget(page, { shelf: 0, slot: 1, slots: 1 });
  await expect.poll(() => placements(page)).toEqual([{ id: 0, type: 'heavy', shelf: 0, slot: 1 }]);
  await expect(undo).toHaveAttribute('aria-disabled', 'false');
  await frames(page, 20);
  await page.screenshot({ path: `${SHOTS}/2d-undo-enabled.png` });

  await undo.dispatchEvent('click');
  await expect(page.locator('.toast')).toContainText('LAST MOVE UNDONE');
  let snap = await snapshot(page);
  expect(snap.placements).toEqual(start.placements);
  expect(snap.queue).toEqual(start.queue);
  expect(snap.assists).toEqual({ hints: 0, undos: 1 });
  expect(snap.undoLeft).toBe(0);
  await expect(undo).toHaveAttribute('aria-disabled', 'true');

  // Move again: the undo stays spent.
  await selectCargo(page, 0);
  await tapTarget(page, { shelf: 0, slot: 2, slots: 1 });
  await expect.poll(() => placements(page)).toEqual([{ id: 0, type: 'heavy', shelf: 0, slot: 2 }]);
  await expect(undo).toHaveAttribute('aria-disabled', 'true');
  await frames(page, 20);
  await page.screenshot({ path: `${SHOTS}/2d-undo-disabled.png` });
  await undo.dispatchEvent('click');
  await expect(page.locator('.toast').last()).toContainText('UNDO ALREADY USED THIS SHIPMENT');
  snap = await snapshot(page);
  expect(snap.placements).toEqual([{ id: 0, type: 'heavy', shelf: 0, slot: 2 }]);
  expect(snap.assists.undos).toBe(1);
  expect(errors).toEqual([]);
  await context.close();
});

test('2d: a refused UNDO says why and leaves the selected package selected', async ({ browser, baseURL }) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave('2d'));
  await bootToMenu(page);
  await startLevel(page, 4);
  const undo = page.locator('[data-role="undo"]');

  // Nothing to undo yet.
  await selectCargo(page, 0);
  await undo.dispatchEvent('click');
  await expect(page.locator('.toast', { hasText: 'NOTHING TO UNDO' })).toHaveCount(1);
  expect(await selection(page)).toBe(0);
  expect(await held(page)).toBe(0);

  // The undo spent.
  await tapTarget(page, { shelf: 0, slot: 2, slots: 1 });
  await expect.poll(() => placements(page)).toEqual([{ id: 0, type: 'heavy', shelf: 0, slot: 2 }]);
  await undo.dispatchEvent('click');
  await expect.poll(() => placements(page)).toEqual([]);
  await selectCargo(page, 0);
  await tapTarget(page, { shelf: 0, slot: 2, slots: 1 });
  await expect.poll(() => placements(page)).toEqual([{ id: 0, type: 'heavy', shelf: 0, slot: 2 }]);
  await selectCargo(page, 1);
  await undo.dispatchEvent('click');
  await expect(page.locator('.toast', { hasText: 'UNDO ALREADY USED THIS SHIPMENT' })).toHaveCount(1);
  expect(await selection(page)).toBe(1);
  expect(await held(page)).toBe(1);
  expect(errors).toEqual([]);
  await context.close();
});

/** Pixels of the hint's gold (#ffc93c: dashed outline and icon) within 16 CSS px of a point on the 2D canvas. */
const hintGoldNear = (page: Page, p: { x: number; y: number }) =>
  page.evaluate(({ x, y }) => {
    const c = document.getElementById('game-canvas') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    const half = Math.round(16 * k);
    const cx = Math.round((x - r.left) * k);
    const cy = Math.round((y - r.top) * k);
    const d = c.getContext('2d')!.getImageData(cx - half, cy - half, half * 2, half * 2).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] > 175 && d[i + 1] < 225 && d[i + 2] < 110) n++;
    return n;
  }, p);

test('2d: tapping the package a HINT points at keeps the hint up; the move clears it', async ({ browser, baseURL }) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave('2d'));
  await bootToMenu(page);
  await startLevel(page, 4);
  const board = await page.evaluate(() => window.__cargoPanic!.board());
  const hint = hintFor(board.level, [...board.placements], [...board.queue], 0);
  if (hint.kind === 'stuck') throw new Error('level 4 has a hint for its first crate');
  const spot = await pointOf(page, { shelf: hint.shelf, slot: hint.slot, slots: 1 });
  const gold = () => hintGoldNear(page, spot);
  const before = await gold();

  await page.locator('[data-role="hint"]').dispatchEvent('click');
  await expect.poll(gold).toBeGreaterThan(before + 20);
  expect((await snapshot(page)).assists.hints).toBe(1);
  await page.screenshot({ path: `${SHOTS}/2d-hint.png` });

  // Tap-selecting the crate is using the hint, not dropping it.
  await selectCargo(page, 0);
  await frames(page, 5);
  expect(await gold()).toBeGreaterThan(before + 20);
  await page.screenshot({ path: `${SHOTS}/2d-hint-selected.png` });

  // Placed somewhere else: the hint is stale and goes.
  const other = hint.slot === 1 ? 3 : 1;
  await tapTarget(page, { shelf: hint.shelf, slot: other, slots: 1 });
  await expect.poll(async () => (await placements(page)).map((p) => p.slot)).toEqual([other]);
  await frames(page, 5);
  expect(await gold()).toBeLessThanOrEqual(before + 5);
  expect(errors).toEqual([]);
  await context.close();
});

// ---------------------------------------------------------------------------
// Touch: one finger at a time, and a cancelled touch.
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number };

/*
 * CDP touch: every touchStart / touchMove lists ALL fingers that are down;
 * a finger missing from the list is lifted (one pointerup for it). touchEnd
 * and touchCancel carry no points and end every finger.
 */
async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: (Pt & { id: number })[]) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })),
  });
}

/** Finger 1 down on package `cargo` and dragged until the game aims it at `t` (the touch lift is followed). */
async function touchDragTo(page: Page, cdp: CDPSession, cargo: number, t: { shelf: number; slot: number; slots: number }) {
  const want = JSON.stringify({ kind: 'slot', shelf: t.shelf, slot: t.slot });
  const from = await pointOf(page, { cargo });
  await touch(cdp, 'touchStart', [{ ...from, id: 1 }]);
  await expect.poll(() => held(page)).toBe(cargo);
  let at = from;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (JSON.stringify(await aimed(page)) === want) return at;
    const target = await pointOf(page, t);
    const drawn = await pointOf(page, { cargo });
    // Move the finger so the package (drawn above it on touch) is over the target.
    at = { x: at.x + (target.x - drawn.x), y: at.y + (target.y - drawn.y) };
    await touch(cdp, 'touchMove', [{ ...at, id: 1 }]);
    await frames(page, 2);
  }
  throw new Error(`never aimed at ${want}`);
}

test('2d: a second finger cannot steal, aim or drop the package the first finger holds', async ({ browser, baseURL }) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave('2d'));
  await bootToMenu(page);
  await startLevel(page, 4);
  const cdp = await context.newCDPSession(page);
  const hand = new Hand(page);
  await hand.drag(0, { shelf: 0, slot: 2, slots: 1 }); // heavy in the middle
  await expect.poll(() => placements(page)).toEqual([{ id: 0, type: 'heavy', shelf: 0, slot: 2 }]);
  await frames(page, 20);

  // Finger 1 takes the live package (1) over slot 1 and stays down.
  const f1 = await touchDragTo(page, cdp, 1, { shelf: 0, slot: 1, slots: 1 });
  // Finger 2 lands on the stowed crate, drags it toward slot 4, lifts.
  const crate = await pointOf(page, { cargo: 0 });
  const slot4 = await pointOf(page, { shelf: 0, slot: 4, slots: 1 });
  await touch(cdp, 'touchStart', [{ ...f1, id: 1 }, { ...crate, id: 2 }]);
  await frames(page, 3);
  await touch(cdp, 'touchMove', [{ ...f1, id: 1 }, { ...slot4, id: 2 }]);
  await frames(page, 3);
  expect(await held(page)).toBe(1);
  expect(await aimed(page)).toEqual({ kind: 'slot', shelf: 0, slot: 1 });
  await touch(cdp, 'touchMove', [{ ...f1, id: 1 }]); // finger 2 lifts, finger 1 stays down
  await frames(page, 3);
  expect(await placements(page)).toEqual([{ id: 0, type: 'heavy', shelf: 0, slot: 2 }]);
  expect(await held(page)).toBe(1);

  // Finger 1 lifts: exactly its target is committed.
  await touch(cdp, 'touchEnd', []);
  await expect.poll(() => placements(page)).toEqual([
    { id: 0, type: 'heavy', shelf: 0, slot: 2 },
    { id: 1, type: 'heavy', shelf: 0, slot: 1 },
  ]);
  await frames(page, 20);

  // Tap-select the last box; finger 1 aims it at slot 3 and stays down. Finger 2 lands on the empty
  // slot 4 and lifts there: it must neither take over the aim nor drop the box (only the one-pointer
  // rule stops that - the session would accept a move to slot 4).
  await expect
    .poll(
      async () => {
        const box = await pointOf(page, { cargo: 2 });
        await touch(cdp, 'touchStart', [{ ...box, id: 1 }]);
        await touch(cdp, 'touchEnd', []);
        return selection(page);
      },
      { timeout: 60_000 },
    )
    .toBe(2);
  const slot3 = await pointOf(page, { shelf: 0, slot: 3, slots: 1 });
  await touch(cdp, 'touchStart', [{ ...slot3, id: 1 }]);
  await expect.poll(() => aimed(page)).toEqual({ kind: 'slot', shelf: 0, slot: 3 });
  await touch(cdp, 'touchStart', [{ ...slot3, id: 1 }, { ...slot4, id: 2 }]);
  await frames(page, 3);
  await touch(cdp, 'touchMove', [{ ...slot3, id: 1 }]); // finger 2 lifts over slot 4
  await frames(page, 3);
  expect((await placements(page)).length).toBe(2);
  expect(await aimed(page)).toEqual({ kind: 'slot', shelf: 0, slot: 3 });
  expect(await selection(page)).toBe(2);
  await touch(cdp, 'touchEnd', []);
  await expect.poll(async () => (await placements(page)).find((p) => p.id === 2)).toEqual({
    id: 2,
    type: 'standard',
    shelf: 0,
    slot: 3,
  });
  expect(errors).toEqual([]);
  await context.close();
});

test('2d: a cancelled touch mid-drag puts the package back and duplicates nothing', async ({ browser, baseURL }) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave('2d'));
  await bootToMenu(page);
  await startLevel(page, 4);
  const cdp = await context.newCDPSession(page);
  const start = await snapshot(page);

  // A belt package, cancelled while aimed at a legal slot.
  await touchDragTo(page, cdp, 0, { shelf: 0, slot: 2, slots: 1 });
  await touch(cdp, 'touchCancel', []);
  await expect.poll(() => held(page)).toBeNull();
  await frames(page, 10);
  let snap = await snapshot(page);
  expect(snap.placements).toEqual(start.placements);
  expect(snap.queue).toEqual(start.queue);

  // A stowed package, cancelled while aimed elsewhere.
  const hand = new Hand(page);
  await hand.drag(0, { shelf: 0, slot: 2, slots: 1 });
  await expect.poll(() => placements(page)).toEqual([{ id: 0, type: 'heavy', shelf: 0, slot: 2 }]);
  await frames(page, 20);
  await touchDragTo(page, cdp, 0, { shelf: 0, slot: 4, slots: 1 });
  await touch(cdp, 'touchCancel', []);
  await expect.poll(() => held(page)).toBeNull();
  await frames(page, 10);
  snap = await snapshot(page);
  expect(snap.placements).toEqual([{ id: 0, type: 'heavy', shelf: 0, slot: 2 }]);
  expect(snap.queue).toEqual([1, 2]);
  const ids = [...snap.queue, ...snap.placements.map((p) => p.id)].sort();
  expect(ids).toEqual([0, 1, 2]);
  expect(snap.rejectedDrops).toBe(0);
  expect(errors).toEqual([]);
  await context.close();
});
