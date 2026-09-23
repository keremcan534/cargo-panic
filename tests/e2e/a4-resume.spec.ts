/**
 * A4 in the real game (2D, so headless frames are quick): the game in
 * progress survives a browser reload and comes back paused with the same
 * clocks; the page going hidden pauses it and no time is charged; a cleared
 * Endless wave is paid once however the game is reloaded; the undo right
 * is not renewed by a reload; damaged saves are recovered or reported;
 * a failing write shows "Progress cannot be saved".
 *
 * Browser only. "Hidden" is emulated with document.visibilityState and a
 * visibilitychange event (rAF keeps running, which makes this stricter than
 * a real background tab: only the lifecycle pause stops the clocks). The
 * native lifecycle is not tested here: the Capacitor App plugin is not
 * installed. The last test drives our handlers through a FAKE plugin object
 * - that checks the JS wiring only, not a device.
 *
 * Headless desktop Chromium with a phone viewport: functional checks, not
 * device measurements. Screenshots (360 x 640): test-results/a4/.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { getWave } from '../../src/game/levels/generator';
import { PACKAGE_SPECS } from '../../src/game/levels/types';
import type { SaveData } from '../../src/game/save/schema';
import {
  Hand,
  bootToMenu,
  openWithSave,
  pause,
  rules,
  selectCargo,
  snapshot,
  startLevel,
  storedSave,
  tapTarget,
} from './support/game';
import { SAVE_KEY, saveData, v2Save } from './support/save';

const SHOTS = 'test-results/a4';
const PHONE = { width: 360, height: 640 };

/** 2D, guide skipped and every cargo type already explained, so nothing sits over the rack. */
const quietSave = (edit: (d: SaveData) => void = () => undefined, unlocked?: number) =>
  v2Save((d) => {
    d.settings.renderMode = '2d';
    d.tutorial.skipped = true;
    d.tutorial.seenCargo = ['heavy', 'fragile', 'long', 'priority'];
    edit(d);
  }, unlocked);

const stored = async (page: Page) => saveData(await storedSave(page));
const phase = async (page: Page) => (await snapshot(page)).phase;
const placed = async (page: Page) => (await snapshot(page)).placements.length;

/**
 * Waits until at least `ms` of wall time has passed in the page AND the
 * loop has drawn `n` more frames - time was on offer to the clocks, so a
 * clock that did not move was really held.
 */
async function letTimePass(page: Page, ms: number, n: number) {
  const t0 = await page.evaluate(() => ({ t: performance.now(), f: window.__cargoPanicApp!.frames }));
  await expect
    .poll(
      () =>
        page.evaluate(
          ([t, f, wait, count]) => performance.now() - t >= wait && window.__cargoPanicApp!.frames >= f + count,
          [t0.t, t0.f, ms, n] as const,
        ),
      { timeout: 60_000 },
    )
    .toBe(true);
}

/** Emulates the page going to the background / coming back (see the file comment). */
async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
  await expect.poll(() => page.evaluate(() => window.__cargoPanicApp!.hidden)).toBe(state === 'hidden');
}

/** Level 4: the first heavy crate in the middle, the second on the right end - the rack tips and its clock runs. */
async function tipLevel4(page: Page) {
  const hand = new Hand(page);
  await hand.drag(0, { shelf: 0, slot: 2, slots: 1 });
  await hand.drag(1, { shelf: 0, slot: 4, slots: 1 });
  await expect.poll(() => placed(page)).toBe(2);
  await expect(page.locator('.hazard.on')).toBeVisible();
}

async function continueFromMenu(page: Page, label: string) {
  const cont = page.locator('.menu [data-role="continue"]');
  await expect(cont).toHaveText(label, { timeout: 90_000 });
  await cont.dispatchEvent('click');
  await expect(page.locator('.modal.pause [data-role="away"]')).toHaveText('Paused while you were away. Nothing moved.', {
    timeout: 60_000,
  });
  await page.waitForFunction(() => !!window.__cargoPanic);
}

const resume = (page: Page) => page.locator('[data-role="resume"]').dispatchEvent('click');

// ---------------------------------------------------------------------------

test('reload mid-shipment: CONTINUE brings back the board and the SAME hazard clock, paused until RESUME', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave(), undefined, { viewport: PHONE });
  await bootToMenu(page);
  await expect(page.locator('.menu [data-role="continue"]')).toHaveCount(0);
  await startLevel(page, 4);
  await tipLevel4(page);
  await pause(page); // a commit: the save now holds exactly this paused state
  const before = await rules(page);
  expect(before.hazards.balance).toBeGreaterThan(0);
  expect(before.hazards.balance).toBeLessThan(3000);
  const savedClocks = async () => {
    const a = (await stored(page))?.active;
    return a?.kind === 'campaign' ? { phase: a.shipment.phase, hazards: a.shipment.hazards, activeMs: a.shipment.activeMs } : null;
  };
  await expect.poll(savedClocks).toEqual({ phase: 'paused', hazards: before.hazards, activeMs: before.activeMs });

  await page.reload();
  // CONTINUE first; PLAY still starts fresh (no level cleared yet in this save, so it reads PLAY).
  await expect(page.locator('.menu [data-role="play"]')).toHaveText('PLAY', { timeout: 90_000 });
  await expect(page.locator('.menu [data-role="continue"]')).toHaveText('CONTINUE - LEVEL 4');
  await page.screenshot({ path: `${SHOTS}/menu-continue.png` });
  await continueFromMenu(page, 'CONTINUE - LEVEL 4');

  expect(await phase(page)).toBe('paused');
  expect(await rules(page)).toEqual(before); // placements, queue, hazards (+-0), activeMs, assists, undoLeft...
  await letTimePass(page, 3000, 10);
  expect(await rules(page)).toEqual(before);
  expect(await phase(page)).toBe('paused');
  await page.screenshot({ path: `${SHOTS}/pause-away-after-reload.png` });

  await resume(page);
  await expect.poll(() => phase(page)).toBe('play');
  await expect.poll(async () => (await snapshot(page)).hazards.balance).toBeLessThan(before.hazards.balance);
  expect(errors).toEqual([]);
  await context.close();
});

test('hidden for 3 s: paused with the away note, hazard clock unchanged, still paused when back; Escape toggles pause', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave(), undefined, { viewport: PHONE });
  await bootToMenu(page);
  await startLevel(page, 4);
  await tipLevel4(page);

  await setVisibility(page, 'hidden');
  const away = await rules(page);
  expect(await phase(page)).toBe('paused');
  expect(await page.evaluate(() => window.__cargoPanic!.pauseReasons)).toEqual(expect.arrayContaining(['hidden', 'menu']));
  // Saved at once on the way out.
  const saved = (await stored(page))!.active as Extract<SaveData['active'], { kind: 'campaign' }>;
  expect(saved.shipment.hazards).toEqual(away.hazards);
  expect(saved.shipment.phase).toBe('paused');

  await letTimePass(page, 3000, 10);
  expect(await rules(page)).toEqual(away);
  await setVisibility(page, 'visible');
  await letTimePass(page, 500, 5);
  expect(await phase(page)).toBe('paused');
  expect(await rules(page)).toEqual(away);
  await expect(page.locator('.modal.pause [data-role="away"]')).toHaveText('Paused while you were away. Nothing moved.');
  await page.screenshot({ path: `${SHOTS}/pause-away-after-hidden.png` });

  // Escape is the web's back button: it resumes from the panel, and opens it again.
  await page.keyboard.press('Escape');
  await expect.poll(() => phase(page)).toBe('play');
  await expect(page.locator('.modal.pause')).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).hazards.balance).toBeLessThan(away.hazards.balance);
  await pause(page);
  await expect(page.locator('.modal.pause [data-role="away"]')).toHaveCount(0);
  expect(await phase(page)).toBe('paused');
  expect(errors).toEqual([]);
  await context.close();
});

test('Endless: a cleared wave is paid once - reloaded in the dispatch and mid-wave, then the next wave clears once', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave(), undefined, { viewport: PHONE });
  await bootToMenu(page, '&seed=12345');
  await page.locator('.menu [data-role="endless"]').dispatchEvent('click');
  await expect(page.locator('.hud .title')).toHaveText('WAVE 1', { timeout: 60_000 });
  await page.waitForFunction(() => !!window.__cargoPanic);
  const { runId } = (await snapshot(page)).source as { runId: string };
  const hand = new Hand(page);
  const drag = (p: { id: number; shelf: number; slot: number; type: keyof typeof PACKAGE_SPECS }) =>
    hand.drag(p.id, { shelf: p.shelf, slot: p.slot, slots: PACKAGE_SPECS[p.type].slots });

  for (const p of getWave(12345, 1).solution) await drag(p);
  const card = page.locator('.wave-card');
  await expect(card).toContainText('SHIPMENT DISPATCHED', { timeout: 30_000 });
  const t1 = Number((await card.locator('.total').innerText()).replace(/[^0-9]/g, ''));
  expect(t1).toBeGreaterThan(0);
  const score = (n: number) => n.toLocaleString('en-US');
  await expect(page.locator('.hud .subtitle')).toHaveText(score(t1));

  // Written at the win, as one claim: the reward, the move to wave 2, the run. Wave 2 not dealt yet.
  const atWin = (await stored(page))!;
  expect(atWin.claimed.filter((id) => id === `endless:${runId}:w1`)).toHaveLength(1);
  expect(atWin.active).toMatchObject({ kind: 'endless', run: { wave: 2, score: t1, rewardedThrough: 1 }, shipment: null });

  // Reload in the dispatch, before wave 2 is dealt.
  await page.reload();
  await continueFromMenu(page, 'CONTINUE SHIFT - WAVE 2');
  await expect(page.locator('.hud .title')).toHaveText('WAVE 2');
  await expect(page.locator('.hud .subtitle')).toHaveText(score(t1));
  expect((await snapshot(page)).source).toMatchObject({ mode: 'endless', seed: 12345, wave: 2 });
  await resume(page);
  await expect.poll(() => phase(page)).toBe('play');

  const wave2 = getWave(12345, 2).solution;
  await drag(wave2[0]);
  await expect.poll(() => placed(page)).toBe(1);

  // Reload during wave 2.
  await page.reload();
  await continueFromMenu(page, 'CONTINUE SHIFT - WAVE 2');
  await expect(page.locator('.hud .subtitle')).toHaveText(score(t1));
  expect(await placed(page)).toBe(1);
  await resume(page);
  await expect.poll(() => phase(page)).toBe('play');
  for (const p of wave2.slice(1)) await drag(p);
  await expect(card).toContainText('SHIPMENT DISPATCHED', { timeout: 30_000 });
  const t2 = Number((await card.locator('.total').innerText()).replace(/[^0-9]/g, ''));
  expect(t2).toBeGreaterThan(0);
  await expect(page.locator('.hud .subtitle')).toHaveText(score(t1 + t2));

  await expect(page.locator('.hud .title')).toHaveText('WAVE 3', { timeout: 60_000 });
  await expect(page.locator('.hud .subtitle')).toHaveText(score(t1 + t2));
  const end = (await stored(page))!;
  const ids = end.claimed.filter((id) => id.startsWith(`endless:${runId}:`));
  expect(ids.sort()).toEqual([`endless:${runId}:w1`, `endless:${runId}:w2`]);
  expect(end.active).toMatchObject({ kind: 'endless', run: { wave: 3, score: t1 + t2, rewardedThrough: 2 } });
  expect(errors).toEqual([]);
  await context.close();
});

test('Endless: a wave dealt while the page is hidden starts paused, with the away note', async ({ browser, baseURL }) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave(), undefined, { viewport: PHONE });
  await bootToMenu(page, '&seed=12345');
  await page.locator('.menu [data-role="endless"]').dispatchEvent('click');
  await expect(page.locator('.hud .title')).toHaveText('WAVE 1', { timeout: 60_000 });
  await page.waitForFunction(() => !!window.__cargoPanic);
  const hand = new Hand(page);
  for (const p of getWave(12345, 1).solution) {
    await hand.drag(p.id, { shelf: p.shelf, slot: p.slot, slots: PACKAGE_SPECS[p.type].slots });
  }
  await expect(page.locator('.wave-card')).toContainText('SHIPMENT DISPATCHED', { timeout: 30_000 });
  // Hidden during the dispatch. (Emulated: frames still run here, so the frame-clock delay deals wave 2
  // while the page says hidden. In a real background tab no frames run and the delay itself waits.)
  await setVisibility(page, 'hidden');
  await expect(page.locator('.hud .title')).toHaveText('WAVE 2', { timeout: 60_000 });
  await expect(page.locator('.modal.pause [data-role="away"]')).toBeVisible();
  expect(await phase(page)).toBe('paused');
  expect(await page.evaluate(() => window.__cargoPanic!.pauseReasons)).toEqual(expect.arrayContaining(['hidden']));
  await letTimePass(page, 1500, 10);
  expect((await snapshot(page)).activeMs).toBe(0);
  await setVisibility(page, 'visible');
  await letTimePass(page, 300, 3);
  expect(await phase(page)).toBe('paused');
  await resume(page);
  await expect.poll(() => phase(page)).toBe('play');
  await expect.poll(async () => (await snapshot(page)).activeMs).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await context.close();
});

test('an undo used before a reload stays used after it (and an unused one stays available)', async ({ browser, baseURL }) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave(), undefined, { viewport: PHONE });
  await bootToMenu(page);
  await startLevel(page, 2);
  const undo = page.locator('[data-role="undo"]');
  await selectCargo(page, 0);
  await tapTarget(page, { shelf: 0, slot: 0, slots: 1 });
  await expect.poll(() => placed(page)).toBe(1);
  await expect(undo).toHaveAttribute('aria-disabled', 'false');

  // Not used yet: a reload keeps it available.
  await page.reload();
  await continueFromMenu(page, 'CONTINUE - LEVEL 2');
  await resume(page);
  await expect.poll(() => phase(page)).toBe('play');
  await expect(undo).toHaveAttribute('aria-disabled', 'false');

  await undo.dispatchEvent('click');
  await expect(page.locator('.toast').last()).toContainText('LAST MOVE UNDONE');
  await selectCargo(page, 0);
  await tapTarget(page, { shelf: 0, slot: 1, slots: 1 });
  await expect.poll(() => placed(page)).toBe(1);
  await expect(undo).toHaveAttribute('aria-disabled', 'true');

  // Used: a reload does not give it back.
  await page.reload();
  await continueFromMenu(page, 'CONTINUE - LEVEL 2');
  const snap = await snapshot(page);
  expect(snap.undoLeft).toBe(0);
  expect(snap.assists.undos).toBe(1);
  await resume(page);
  await expect.poll(() => phase(page)).toBe('play');
  await expect(undo).toHaveAttribute('aria-disabled', 'true');
  await undo.dispatchEvent('click');
  await expect(page.locator('.toast').last()).toContainText('UNDO ALREADY USED THIS SHIPMENT');
  expect((await snapshot(page)).placements).toEqual([{ id: 0, type: 'standard', shelf: 0, slot: 1 }]);
  expect(errors).toEqual([]);
  await context.close();
});

test('a damaged save is restored from its backup, and the player is told', async ({ browser, baseURL }) => {
  const backup = quietSave((d) => {
    d.campaign.stars = { 1: 3, 2: 2 };
  }, 3);
  const { context, page, errors } = await openWithSave(browser, baseURL, 'garbage{', undefined, {
    viewport: PHONE,
    storage: { 'cargo-panic.save.v2.bak': backup },
  });
  await bootToMenu(page);
  const card = page.locator('[data-role="save-recovered-backup"]');
  await expect(card).toContainText('Your save was damaged, so it was restored from the last backup.');
  await page.screenshot({ path: `${SHOTS}/notice-recovered-backup.png` });
  await card.locator('[data-role="save-ok"]').click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.menu .chip')).toContainText('★ 5 / 75');
  await expect(page.locator('.menu .chip')).toContainText('2 / 25');
  const keys = await page.evaluate(() => ({
    corrupt: localStorage.getItem('cargo-panic.save.corrupt'),
    main: localStorage.getItem('cargo-panic.save.v2'),
  }));
  expect(keys.corrupt).toBe('garbage{');
  expect(saveData(keys.main)?.campaign.stars).toEqual({ 1: 3, 2: 2 });
  expect(errors).toEqual([]);
  await context.close();
});

test('an unreadable save with no backup is kept aside and the player is told (no silent reset)', async ({
  browser,
  baseURL,
}) => {
  const { context, page, errors } = await openWithSave(browser, baseURL, 'garbage{', undefined, { viewport: PHONE });
  await bootToMenu(page);
  const card = page.locator('[data-role="save-unreadable"]');
  await expect(card).toContainText('Your save could not be read. A copy was kept aside and a new save was started.');
  await page.screenshot({ path: `${SHOTS}/notice-unreadable.png` });
  expect(await page.evaluate(() => localStorage.getItem('cargo-panic.save.corrupt'))).toBe('garbage{');
  await card.locator('[data-role="save-ok"]').click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.menu .chip')).toContainText('★ 0 / 75');
  expect(errors).toEqual([]);
  await context.close();
});

test('when writes fail, "Progress cannot be saved" stays up and play goes on; it goes once a write works', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave(), undefined, { viewport: PHONE });
  await bootToMenu(page);
  await startLevel(page, 2);
  const banner = page.locator('[data-role="save-banner"]');
  await expect(banner).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as unknown as { __setItem: typeof Storage.prototype.setItem };
    w.__setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  });
  await selectCargo(page, 0);
  await tapTarget(page, { shelf: 0, slot: 0, slots: 1 });
  await expect(banner).toHaveText('Progress cannot be saved right now.');
  await expect(banner).toHaveAttribute('role', 'status');

  // The game keeps working.
  await selectCargo(page, 1);
  await tapTarget(page, { shelf: 0, slot: 4, slots: 1 });
  await expect.poll(() => placed(page)).toBe(2);
  expect(await phase(page)).toBe('play');
  await expect(banner).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/banner-write-failed.png` });

  // Storage works again: the next commit is written and the banner goes.
  await page.evaluate(() => {
    const w = window as unknown as { __setItem: typeof Storage.prototype.setItem };
    Storage.prototype.setItem = w.__setItem;
  });
  await selectCargo(page, 2);
  await tapTarget(page, { shelf: 0, slot: 1, slots: 1 });
  await expect(banner).toHaveCount(0);
  const active = (await stored(page))!.active as Extract<SaveData['active'], { kind: 'campaign' }>;
  expect(active.shipment.placements).toHaveLength(3);
  expect(errors).toEqual([]);
  await context.close();
});

test('a saved game this version cannot continue is dropped with a message; records stay', async ({ browser, baseURL }) => {
  // A level 1 game saved under ruleset 1: well-formed, but not this version's rules.
  const save = quietSave((d) => {
    d.campaign.stars = { 1: 3 };
    d.active = {
      kind: 'campaign',
      levelId: 1,
      rulesetVersion: 1,
      shipment: {
        v: 1,
        ruleset: 1,
        generator: 1,
        source: { mode: 'campaign', levelId: 1 },
        levelFingerprint: 'x',
        graceScale: 1,
        phase: 'play',
        placements: [],
        queue: [0, 1],
        hazards: { balance: 3000, overload: [], fragile: [] },
        winSettleMs: 0,
        activeMs: 0,
        dangerMs: 0,
        assists: { hints: 0, undos: 0 },
        rejectedDrops: 0,
        undoLeft: 1,
        undo: null,
        outcome: null,
      },
    };
  }, 2);
  const { context, page, errors } = await openWithSave(browser, baseURL, save, undefined, { viewport: PHONE });
  await bootToMenu(page);
  const cont = page.locator('.menu [data-role="continue"]');
  await expect(cont).toHaveText('CONTINUE - LEVEL 1');
  await cont.dispatchEvent('click');
  const card = page.locator('[data-role="resume-failed"]');
  await expect(card).toContainText('The saved game cannot be continued in this version. Your stars and records are safe.');
  await expect(page.locator('.menu [data-role="continue"]')).toHaveCount(0);
  await card.locator('[data-role="save-ok"]').click();
  await expect(page.locator('.menu .chip')).toContainText('★ 3 / 75');
  const d = (await stored(page))!;
  expect(d.active).toBeNull();
  expect(d.campaign.stars).toEqual({ 1: 3 });
  expect(errors).toEqual([]);
  await context.close();
});

test('starting fresh over a shift with points asks first; KEEP keeps it, START NEW replaces it', async ({ browser, baseURL }) => {
  const save = quietSave((d) => {
    d.active = {
      kind: 'endless',
      rulesetVersion: 2,
      generatorVersion: 1,
      run: { runId: 'kept', seed: 12345, wave: 3, score: 1500, stowed: 9, cleanWaves: 1, assisted: false, rewardedThrough: 2 },
      shipment: null,
    };
  });
  const { context, page, errors } = await openWithSave(browser, baseURL, save, undefined, { viewport: PHONE });
  await bootToMenu(page);
  await expect(page.locator('.menu [data-role="continue"]')).toHaveText('CONTINUE SHIFT - WAVE 3');

  await page.locator('.menu [data-role="endless"]').dispatchEvent('click');
  const ask = page.locator('.modal.confirm');
  await expect(ask).toContainText('Your shift is on wave 3 with 1,500 points.');
  await ask.locator('[data-role="cancel"]').dispatchEvent('click');
  await expect(ask).toHaveCount(0);
  await expect(page.locator('.menu [data-role="continue"]')).toHaveText('CONTINUE SHIFT - WAVE 3');
  expect(((await stored(page))!.active as { run: { runId: string } }).run.runId).toBe('kept');

  await page.locator('.menu [data-role="play"]').dispatchEvent('click');
  await expect(ask).toBeVisible();
  await ask.locator('[data-role="confirm"]').dispatchEvent('click');
  await expect(page.locator('.hud .title')).toHaveText('LEVEL 25', { timeout: 60_000 });
  await expect.poll(async () => (await stored(page))?.active?.kind).toBe('campaign');
  expect(errors).toEqual([]);
  await context.close();
});

test('native lifecycle WIRING through a FAKE Capacitor App plugin (browser only, not a device)', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const fakePlugin = () => {
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const w = window as unknown as Record<string, unknown>;
    w.__exits = 0;
    w.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        App: {
          addListener: (ev: string, cb: (e: unknown) => void) => {
            (listeners[ev] ??= []).push(cb);
            return { remove() {} };
          },
          exitApp: () => {
            w.__exits = (w.__exits as number) + 1;
          },
        },
      },
    };
    w.__native = (ev: string, arg: unknown) => listeners[ev]?.forEach((cb) => cb(arg));
  };
  const native = (page: Page, ev: 'appStateChange' | 'backButton', arg: unknown = {}) =>
    page.evaluate(([e, a]) => (window as unknown as { __native: (e: string, a: unknown) => void }).__native(e, a), [
      ev,
      arg,
    ] as const);
  const exits = (page: Page) => page.evaluate(() => (window as unknown as { __exits: number }).__exits);

  // A damaged save with a good backup, so a save message is up at boot.
  const { context, page, errors } = await openWithSave(browser, baseURL, 'garbage{', fakePlugin, {
    viewport: PHONE,
    storage: { 'cargo-panic.save.v2.bak': quietSave() },
  });
  await bootToMenu(page);
  const card = page.locator('[data-role="save-recovered-backup"]');
  await expect(card).toBeVisible();
  // Back acknowledges the message first; on the bare title screen the app may exit.
  await native(page, 'backButton');
  await expect(card).toHaveCount(0);
  expect(await exits(page)).toBe(0);
  await native(page, 'backButton');
  expect(await exits(page)).toBe(1);

  await startLevel(page, 4);
  await tipLevel4(page);
  await native(page, 'appStateChange', { isActive: false });
  await expect.poll(() => page.evaluate(() => window.__cargoPanicApp!.hidden)).toBe(true);
  expect(await phase(page)).toBe('paused');
  const away = await rules(page);
  await letTimePass(page, 1000, 5);
  await native(page, 'appStateChange', { isActive: true });
  await expect.poll(() => page.evaluate(() => window.__cargoPanicApp!.hidden)).toBe(false);
  expect(await rules(page)).toEqual(away);
  await expect(page.locator('.modal.pause [data-role="away"]')).toBeVisible();

  // Back in the game toggles pause and never exits.
  await native(page, 'backButton');
  await expect.poll(() => phase(page)).toBe('play');
  await native(page, 'backButton');
  await expect(page.locator('.modal.pause')).toBeVisible();
  expect(await phase(page)).toBe('paused');
  expect(await exits(page)).toBe(1);
  expect(errors).toEqual([]);
  await context.close();
});

// ---------------------------------------------------------------------------
// Review fixes

/**
 * Presses a pause panel button and, in the same task - before the panel's
 * 190 ms close has finished - lets the page go away (pagehide) and reads the
 * save a reload would find then. The page is shown again afterwards.
 */
async function pressThenLeave(page: Page, role: string) {
  const r = await page.evaluate(
    ([button, key]) => {
      const b = document.querySelector<HTMLButtonElement>(`.modal.pause [data-role="${button}"]`);
      if (!b) throw new Error(`no ${button} button`);
      b.click();
      window.dispatchEvent(new Event('pagehide'));
      const closing = document.querySelector('.modal.pause.leave') !== null;
      const raw = localStorage.getItem(key);
      window.dispatchEvent(new Event('pageshow'));
      return { closing, raw };
    },
    [role, SAVE_KEY] as const,
  );
  expect(r.closing).toBe(true); // still inside the close
  return saveData(r.raw);
}

test('RESTART LEVEL and END RUN drop the saved game as they are pressed: leaving during the close keeps nothing', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave(), undefined, { viewport: PHONE });
  await bootToMenu(page);
  await startLevel(page, 2);
  await selectCargo(page, 0);
  await tapTarget(page, { shelf: 0, slot: 0, slots: 1 });
  await expect.poll(() => placed(page)).toBe(1);
  await pause(page);
  await expect.poll(async () => (await stored(page))?.active?.kind).toBe('campaign');
  expect((await pressThenLeave(page, 'restart'))?.active).toBeNull();
  // The level starts again and is the one to resume now.
  const savedPlacements = async () => {
    const a = (await stored(page))?.active;
    return a?.kind === 'campaign' ? a.shipment.placements.length : null;
  };
  await expect.poll(savedPlacements, { timeout: 60_000 }).toBe(0);
  expect(await placed(page)).toBe(0);

  await bootToMenu(page, '&seed=12345');
  await page.locator('.menu [data-role="endless"]').dispatchEvent('click');
  await expect(page.locator('.hud .title')).toHaveText('WAVE 1', { timeout: 60_000 });
  await page.waitForFunction(() => !!window.__cargoPanic);
  await pause(page);
  await expect.poll(async () => (await stored(page))?.active?.kind).toBe('endless');
  expect((await pressThenLeave(page, 'restart'))?.active).toBeNull();
  await expect(page.locator('.menu [data-role="play"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.menu [data-role="continue"]')).toHaveCount(0);
  expect((await stored(page))?.active).toBeNull();
  expect(errors).toEqual([]);
  await context.close();
});

/**
 * Presses EXIT on the pause panel and, once the panel has closed and the
 * screen is fading out to the level select (200 ms), presses Escape or lets
 * the page go away. Returns how many pause panels are on screen right after.
 */
async function actDuringExitFade(page: Page, act: 'escape' | 'hide') {
  return page.evaluate(
    (what) =>
      new Promise<number>((done) => {
        document.querySelector<HTMLButtonElement>('.modal.pause [data-role="exit"]')!.click();
        const poll = () => {
          if (document.querySelector('.modal.pause')) {
            setTimeout(poll, 5);
            return;
          }
          if (what === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          else window.dispatchEvent(new Event('pagehide'));
          const panels = document.querySelectorAll('.modal.pause').length;
          if (what === 'hide') window.dispatchEvent(new Event('pageshow'));
          done(panels);
        };
        poll();
      }),
    act,
  );
}

test('no pause panel opens while the game fades out to another screen (Escape or a hide in the fade)', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const { context, page, errors } = await openWithSave(browser, baseURL, quietSave(), undefined, { viewport: PHONE });
  await bootToMenu(page);
  for (const act of ['escape', 'hide'] as const) {
    await startLevel(page, 2);
    await pause(page);
    expect(await actDuringExitFade(page, act), act).toBe(0);
    await expect(page.locator('.screen.levels')).toHaveCount(1, { timeout: 60_000 });
    await expect(page.locator('.modal')).toHaveCount(0);
    await page.locator('.screen.levels [data-icon="back"]').dispatchEvent('click');
    await expect(page.locator('.menu [data-role="play"]')).toBeVisible({ timeout: 60_000 });
  }
  expect(errors).toEqual([]);
  await context.close();
});
