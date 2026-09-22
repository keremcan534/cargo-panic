/**
 * The Canvas 2D renderer, driven through its dev harness with real pointer
 * drags (no game controller yet): plays level 1 to a win, shows a long
 * package's 3-cell ghost, solves level 25 and part of Endless wave 25, and
 * runs the collapse and fragile-shatter outcomes. Screenshots for review go
 * to test-results/a2/ at 360x640 and 412x915.
 *
 * This does NOT use the production preview build: it has its own baseURL and
 * starts a vite dev server on HARNESS_PORT (default 5199) itself, and stops
 * it afterwards; it refuses to reuse a server already on that port. The
 * harness page is a dev tool that is not part of the build.
 *
 *   npx playwright test -c tests/harness/playwright.config.ts
 * or as part of `npm run test:e2e` (the main config's preview server still
 * starts for the other specs; this one ignores it).
 *
 * Headless desktop Chromium with a phone-sized viewport: a functional and
 * visual check, not a device or performance measurement.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const PORT = Number(process.env.HARNESS_PORT ?? 5199);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SHOTS = 'test-results/a2';

let server: ChildProcess | null = null;

async function up(): Promise<boolean> {
  try {
    const r = await fetch(`${ORIGIN}/tests/harness/canvas2d.html`);
    return r.ok;
  } catch {
    return false;
  }
}

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  // Never reuse a server that is already there: it may be a leftover from
  // another run or another checkout, serving different code.
  if (await up()) {
    throw new Error(`port ${PORT} is already serving; set HARNESS_PORT to a free port`);
  }
  // Run vite's own entry (no npx wrapper) in its own process group, so
  // afterAll can stop it for certain instead of orphaning it.
  server = spawn(
    process.execPath,
    [resolve('node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: process.cwd(), stdio: 'ignore', detached: true },
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await up()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite dev server did not start on ${ORIGIN}`);
});

test.afterAll(() => {
  const pid = server?.pid;
  server = null;
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
});

test.use({ baseURL: ORIGIN });

// ---------------------------------------------------------------------------
// Helpers: everything goes through window.__harness and real mouse input
// ---------------------------------------------------------------------------

interface Pt {
  x: number;
  y: number;
}
type Target = { shelf: number; slot: number };

const SLOTS: Record<string, number> = { standard: 1, heavy: 1, fragile: 1, long: 3, priority: 1 };

async function open(page: Page, query: string, errors: string[]) {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/tests/harness/canvas2d.html?dev=0&${query}`);
  await page.waitForFunction(() => {
    const h = (window as unknown as { __harness?: { frames: number } }).__harness;
    return !!h && h.frames > 3;
  });
}

function harness<T>(page: Page, fn: (h: any) => T): Promise<T> {
  return page.evaluate(`(${fn.toString()})(window.__harness)`) as Promise<T>;
}

async function pointOf(page: Page, target: object): Promise<Pt> {
  const p = (await page.evaluate((t) => (window as any).__harness.clientPointOf(t), target)) as Pt | null;
  expect(p, `no client point for ${JSON.stringify(target)}`).not.toBeNull();
  return p as Pt;
}

/** Waits until the harness has drawn `n` more frames (robust on a slow or busy machine). */
async function frames(page: Page, n = 3) {
  const f0 = (await page.evaluate(() => (window as any).__harness.frames)) as number;
  await page.waitForFunction((f) => (window as any).__harness.frames >= f, f0 + n);
}

/**
 * Real pointer drag of package `id` to a slot (or the belt); `release: false`
 * leaves it in hand. Waits on rendered frames and on the view actually aiming
 * at the destination - never on wall-clock sleeps - so a busy machine cannot
 * make the release land on a stale target.
 */
async function drag(
  page: Page,
  id: number,
  to: Target | 'belt',
  opts: { release?: boolean; expectAim?: boolean } = {},
) {
  const type = await page.evaluate((i) => (window as any).__harness.session.level.packages[i] as string, id);
  const from = await pointOf(page, { cargo: id });
  const dest = to === 'belt' ? await pointOf(page, { belt: true }) : await pointOf(page, { ...to, slots: SLOTS[type] });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await frames(page, 2);
  await page.mouse.move((from.x + dest.x) / 2, Math.min(from.y, dest.y) - 24, { steps: 5 });
  await page.mouse.move(dest.x, dest.y, { steps: 8 });
  // The view recomputes its target in update(): let frames run until it aims where we are.
  await frames(page, 3);
  if (opts.expectAim !== false) {
    const want = to === 'belt' ? { kind: 'belt' } : { kind: 'slot', shelf: to.shelf, slot: to.slot };
    await page.waitForFunction(
      (w) => JSON.stringify((window as any).__harness.view.dragTarget()) === JSON.stringify(w),
      want,
    );
  }
  if (opts.release === false) return;
  await page.mouse.up();
  await frames(page, 6);
  await page.waitForTimeout(150);
}

async function location(page: Page, id: number) {
  return page.evaluate((i) => (window as any).__harness.session.locationOf(i), id);
}

async function waitOutcome(page: Page) {
  await page.waitForFunction(() => (window as any).__harness.outcomes.length > 0, null, { timeout: 10_000 });
  return page.evaluate(() => (window as any).__harness.outcomes[0] as string);
}

/** Places the harness's conveyor-order solution with real drags and checks each landing. */
async function placeSolution(page: Page, limit = Infinity) {
  const sol = (await harness(page, (h) => h.solution())) as { id: number; shelf: number; slot: number }[];
  let n = 0;
  for (;;) {
    if (n >= limit) break;
    const live = (await harness(page, (h) => h.session.current)) as number | null;
    if (live === null) break;
    const spot = sol.find((p) => p.id === live);
    expect(spot, `solution has package ${live}`).toBeTruthy();
    await drag(page, live, { shelf: spot!.shelf, slot: spot!.slot });
    expect(await location(page, live)).toEqual({ at: 'shelf', shelf: spot!.shelf, slot: spot!.slot });
    n++;
  }
  return n;
}

const VIEWPORTS: [number, number][] = [
  [360, 640],
  [412, 915],
];

for (const [w, h] of VIEWPORTS) {
  test.describe(`2D harness ${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}-${w}x${h}.png` });

    test('plays level 1 to a win with real drags', async ({ page }) => {
      const errors: string[] = [];
      await open(page, 'level=1', errors);
      await drag(page, 0, { shelf: 0, slot: 1 });
      expect(await location(page, 0)).toEqual({ at: 'shelf', shelf: 0, slot: 1 });
      await shot(page, 'level1');
      await drag(page, 1, { shelf: 0, slot: 3 });
      expect(await location(page, 1)).toEqual({ at: 'shelf', shelf: 0, slot: 3 });
      expect(await waitOutcome(page)).toBe('won');
      expect(await harness(page, (hh) => hh.session.phase)).toBe('won');
      await page.waitForTimeout(300);
      await shot(page, 'level1-win');
      expect(errors).toEqual([]);
    });

    test('a long package shows all three cells under the finger', async ({ page }) => {
      const errors: string[] = [];
      await open(page, 'level=12', errors);
      const live = (await harness(page, (hh) => hh.session.current)) as number;
      expect(await page.evaluate((i) => (window as any).__harness.session.level.packages[i], live)).toBe('long');
      await drag(page, live, { shelf: 0, slot: 2 }, { release: false });
      await page.waitForTimeout(250);
      expect(await harness(page, (hh) => hh.view.dragTarget())).toEqual({ kind: 'slot', shelf: 0, slot: 2 });
      // Holding does not change the board or advance the belt.
      expect(await location(page, live)).toEqual({ at: 'belt', index: 0 });
      expect(await harness(page, (hh) => hh.session.held)).toBe(live);
      await shot(page, 'drag-long-ghost');
      await page.mouse.up();
      await page.waitForTimeout(400);
      expect(await location(page, live)).toEqual({ at: 'shelf', shelf: 0, slot: 2 });
      expect(errors).toEqual([]);
    });

    test('a refused drop returns the package and changes nothing', async ({ page }) => {
      const errors: string[] = [];
      await open(page, 'level=2', errors);
      await drag(page, 0, { shelf: 0, slot: 2 });
      await drag(page, 1, { shelf: 0, slot: 2 }, { release: false });
      await page.waitForTimeout(150);
      expect(await harness(page, (hh) => hh.view.dragTarget())).toEqual({ kind: 'slot', shelf: 0, slot: 2 });
      await page.mouse.up();
      await page.waitForTimeout(450);
      expect(await location(page, 1)).toEqual({ at: 'belt', index: 0 });
      expect(await location(page, 0)).toEqual({ at: 'shelf', shelf: 0, slot: 2 });
      expect(await harness(page, (hh) => hh.session.rejectedDrops)).toBe(1);
      // Back on the belt: a stowed package dragged onto the belt goes to the front of the queue.
      await drag(page, 0, 'belt');
      expect(await location(page, 0)).toEqual({ at: 'belt', index: 0 });
      expect(errors).toEqual([]);
    });

    test('level 25 full board from the solver, played to a win', async ({ page }) => {
      test.setTimeout(90_000);
      const errors: string[] = [];
      await open(page, 'level=25', errors);
      // Hold the rules clocks while placing so an intermediate red board cannot end the run.
      await harness(page, (hh) => hh.setClocks(false));
      expect(await placeSolution(page)).toBe(9);
      await page.waitForTimeout(500);
      await shot(page, 'level25');
      await harness(page, (hh) => hh.setClocks(true));
      expect(await waitOutcome(page)).toBe('won');
      expect(errors).toEqual([]);
    });

    test('endless seed 12345 wave 25', async ({ page }) => {
      test.setTimeout(90_000);
      const errors: string[] = [];
      await open(page, 'seed=12345&wave=25', errors);
      await harness(page, (hh) => hh.setClocks(false));
      expect(await placeSolution(page, 7)).toBe(7);
      await page.waitForTimeout(500);
      await shot(page, 'endless-12345-w25');
      expect(errors).toEqual([]);
    });

    test('a tipped rack collapses', async ({ page }) => {
      const errors: string[] = [];
      await open(page, 'level=4', errors);
      await drag(page, 0, { shelf: 0, slot: 4 });
      await drag(page, 1, { shelf: 0, slot: 3 });
      expect(await harness(page, (hh) => hh.session.evaluation.status)).toBe('danger');
      expect(await waitOutcome(page)).toBe('failed:balance');
      await harness(page, (hh) => hh.freeze());
      await harness(page, (hh) => hh.step(16, 40));
      await shot(page, 'collapse');
      expect(errors).toEqual([]);
    });

    test('fragile cargo shatters under a heavy crate', async ({ page }) => {
      const errors: string[] = [];
      await open(page, 'level=8', errors);
      await drag(page, 0, { shelf: 0, slot: 2 });
      await drag(page, 1, { shelf: 1, slot: 2 });
      expect(await harness(page, (hh) => hh.session.evaluation.crushed)).toEqual([0]);
      expect(await waitOutcome(page)).toBe('failed:fragile');
      await harness(page, (hh) => hh.freeze());
      await harness(page, (hh) => hh.step(16, 7));
      await shot(page, 'fragile-shatter');
      expect(errors).toEqual([]);
    });

    test('disposing the view and the stage leaves nothing drawing', async ({ page }) => {
      const errors: string[] = [];
      await open(page, 'level=3', errors);
      const result = await page.evaluate(() => {
        const hh = (window as any).__harness;
        hh.freeze();
        hh.view.dispose();
        hh.view.dispose(); // idempotent
        hh.stage.render(16); // no layers: clears to the background
        const before = document.querySelectorAll('#game-canvas').length;
        hh.stage.dispose();
        hh.stage.dispose();
        hh.stage.render(16); // a disposed stage ignores frames
        return { before, after: document.querySelectorAll('#game-canvas').length };
      });
      expect(result).toEqual({ before: 1, after: 0 });
      expect(errors).toEqual([]);
    });

    test('menu backdrop', async ({ page }) => {
      const errors: string[] = [];
      await open(page, 'view=menu', errors);
      await page.waitForTimeout(400);
      await shot(page, 'menu');
      await expect(page.locator('#game-canvas')).toHaveCount(1);
      expect(errors).toEqual([]);
    });
  });
}
