/**
 * 2D / 3D parity: the same semantic command list (package id -> shelf/slot
 * or the belt), played with real pointer drags in the 2D view and in the 3D
 * view, must leave identical rules state after every step and end in the
 * same outcome. Each list is the solver's conveyor-order solution plus a
 * refused drop onto an occupied cell and a stowed package sent back to the
 * belt and placed again.
 *
 * Levels 1, 8 and 15 and Endless seed 12345 wave 1. Headless SwiftShader
 * 3D runs at ~1-2 fps here, so the 3D half is slow; every wait is on game
 * state, not time.
 */

import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { getWave } from '../../src/game/levels/generator';
import { getLevel } from '../../src/game/levels/levels';
import { PACKAGE_SPECS } from '../../src/game/levels/types';
import type { LevelDef } from '../../src/game/levels/types';
import { solve } from '../../src/game/systems/Solver';
import { Hand, bootToMenu, frames, gameMode, openWithSave, snapshot, startLevel } from './support/game';
import { v2Save } from './support/save';

type Command = { cargo: number; to: { shelf: number; slot: number } | 'belt' };

/** Solution in conveyor order, with a refused drop and a round trip to the belt after the first placement. */
function commandsFor(level: LevelDef, solution: { id: number; shelf: number; slot: number }[]): Command[] {
  const [first, second, ...rest] = solution;
  const slots = PACKAGE_SPECS[level.packages[second.id]].slots;
  const width = level.shelves[first.shelf].slots;
  // Overlaps the first package's cell: the rules refuse it ('occupied').
  const clash = { shelf: first.shelf, slot: Math.min(first.slot, width - slots) };
  return [
    { cargo: first.id, to: { shelf: first.shelf, slot: first.slot } },
    { cargo: second.id, to: clash },
    { cargo: first.id, to: 'belt' },
    { cargo: first.id, to: { shelf: first.shelf, slot: first.slot } },
    { cargo: second.id, to: { shelf: second.shelf, slot: second.slot } },
    ...rest.map((p) => ({ cargo: p.id, to: { shelf: p.shelf, slot: p.slot } })),
  ];
}

function campaignSolution(level: LevelDef) {
  const ids = level.packages.map((_, i) => i);
  const r = solve(level, [], ids, { prefixLimit: level.balanceTolerance, nodeBudget: 1_500_000 });
  if (!r.ok) throw new Error(`no conveyor-order solution for level ${level.id}`);
  const at = new Map(r.placements.map((p) => [p.id, p]));
  return ids.map((id) => at.get(id)!);
}

/** What must match between the views after each step. */
async function stepState(page: Page) {
  const s = await snapshot(page);
  return {
    placements: s.placements,
    queue: s.queue,
    assists: s.assists,
    rejectedDrops: s.rejectedDrops,
    undoLeft: s.undoLeft,
  };
}

/** Records the first finished snapshot page-side (Endless deals the next wave ~2.4 s after a win). */
async function watchOutcome(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __firstOutcome: unknown };
    w.__firstOutcome = null;
    const timer = setInterval(() => {
      const s = window.__cargoPanic?.snapshot();
      if (s && (s.phase === 'won' || s.phase === 'failed')) {
        w.__firstOutcome = s;
        clearInterval(timer);
      }
    }, 25);
  });
}

type Snap = Awaited<ReturnType<typeof snapshot>>;

async function waitForOutcome(page: Page) {
  const first = () => page.evaluate(() => (window as unknown as { __firstOutcome: unknown }).__firstOutcome as Snap | null);
  await expect.poll(async () => (await first()) !== null, { timeout: 120_000 }).toBe(true);
  const s = (await first())!;
  const o = s.outcome!;
  return {
    phase: s.phase,
    result: o.result,
    imbalance: o.imbalance,
    limit: o.limit,
    placements: o.placements,
    assists: o.assists,
    rejectedDrops: o.rejectedDrops,
    failure: o.failure ?? null,
    // runId is a fresh random id per run; everything else about the source must match.
    source: { ...o.source, runId: undefined },
  };
}

async function play(
  browser: Browser,
  baseURL: string | undefined,
  mode: '2d' | '3d',
  open: (page: Page) => Promise<void>,
  commands: Command[],
  level: LevelDef,
) {
  const save = v2Save((d) => {
    d.settings.renderMode = mode;
  });
  const { context, page, errors } = await openWithSave(browser, baseURL, save);
  try {
    await open(page);
    expect(await gameMode(page)).toBe(mode);
    await watchOutcome(page);
    const hand = new Hand(page);
    const steps = [];
    for (const c of commands) {
      const before = await stepState(page);
      const slots = PACKAGE_SPECS[level.packages[c.cargo]].slots;
      await hand.drag(c.cargo, c.to === 'belt' ? { belt: true } : { ...c.to, slots });
      // Each drop is exactly one command (or a refusal): wait until the session shows it.
      await expect.poll(async () => JSON.stringify(await stepState(page)), { timeout: 30_000 }).not.toBe(JSON.stringify(before));
      steps.push(await stepState(page));
    }
    console.log(`[parity ${mode}] ${commands.length} commands done`);
    const outcome = await waitForOutcome(page);
    await frames(page, 2);
    expect(errors).toEqual([]);
    return { steps, outcome };
  } finally {
    await context.close();
  }
}

const CAMPAIGN = [1, 8, 15];

for (const id of CAMPAIGN) {
  test(`parity: level ${id} - same commands, same state after every step, same outcome`, async ({ browser, baseURL }) => {
    test.setTimeout(900_000);
    const level = getLevel(id);
    const commands = commandsFor(level, campaignSolution(level));
    const open = async (page: Page) => {
      await bootToMenu(page);
      await startLevel(page, id);
    };
    const flat = await play(browser, baseURL, '2d', open, commands, level);
    const deep = await play(browser, baseURL, '3d', open, commands, level);
    test.info().annotations.push({
      type: `level ${id}`,
      description: `${commands.length} commands; outcome ${flat.outcome.result}, imbalance ${flat.outcome.imbalance}, rejected ${flat.outcome.rejectedDrops}`,
    });
    console.log(`[parity level ${id}] 2D outcome ${JSON.stringify({ ...flat.outcome, placements: flat.outcome.placements.length })}`);
    expect(deep.steps).toEqual(flat.steps);
    expect(deep.outcome).toEqual(flat.outcome);
    expect(flat.outcome.result).toBe('won');
    expect(flat.outcome.rejectedDrops).toBe(1);
    expect(flat.steps[1].rejectedDrops).toBe(1); // the refused drop changed nothing else
    expect(flat.steps[1].placements).toEqual(flat.steps[0].placements);
  });
}

test('parity: Endless seed 12345 wave 1 - same commands, same state, same outcome', async ({ browser, baseURL }) => {
  test.setTimeout(900_000);
  const plan = getWave(12345, 1);
  const commands = commandsFor(plan.level, plan.solution);
  const open = async (page: Page) => {
    await bootToMenu(page, '&seed=12345');
    await page.locator('[data-role="endless"]').dispatchEvent('click');
    await page.waitForFunction(() => !!window.__cargoPanic);
    await expect(page.locator('.hud .title')).toHaveText('WAVE 1');
    expect((await snapshot(page)).source).toMatchObject({ mode: 'endless', seed: 12345, wave: 1 });
    await frames(page, 3);
  };
  const flat = await play(browser, baseURL, '2d', open, commands, plan.level);
  const deep = await play(browser, baseURL, '3d', open, commands, plan.level);
  test.info().annotations.push({
    type: 'endless 12345/1',
    description: `${commands.length} commands; outcome ${flat.outcome.result}, imbalance ${flat.outcome.imbalance}`,
  });
  console.log(`[parity endless 12345/1] 2D outcome ${JSON.stringify({ ...flat.outcome, placements: flat.outcome.placements.length })}`);
  expect(deep.steps).toEqual(flat.steps);
  expect(deep.outcome).toEqual(flat.outcome);
  expect(flat.outcome.result).toBe('won');
});
