/**
 * Every language on the smallest and a tall phone (360 x 640, 412 x 915):
 * the main menu (with Endless records), the settings panel with the language
 * list open, level select, a level HUD with a hazard banner (level 4, a heavy
 * crate on the far end), the pause panel, the loss panel and the win panel.
 *
 * On each screen no text box may run wider than itself or out of the
 * viewport, and no button or label may clip its text. Runs in 2D (the DOM
 * UI is the same in 3D; 2D draws fast in headless Chromium).
 *
 * Also: every campaign level's HUD texts stay above the balance meter in
 * every language; the language list works from the keyboard and applies a
 * pick at once (a Portugal device follows into Brazilian Portuguese); and the
 * canvas-drawn shelf text (sealed plaque, gold-zone tag) draws in Russian in
 * 2D and 3D.
 *
 * Screenshots: test-results/languages/<lang>-<w>x<h>-<screen>.png.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { RULESET_VERSION } from '../../src/game/session/versions';
import { LANGUAGES } from '../../src/i18n/languages';
import type { Lang } from '../../src/i18n/languages';
import { de } from '../../src/i18n/de';
import { en } from '../../src/i18n/en';
import type { TextKey } from '../../src/i18n/en';
import { es } from '../../src/i18n/es';
import { fr } from '../../src/i18n/fr';
import { id } from '../../src/i18n/id';
import { it as itDict } from '../../src/i18n/it';
import { pl } from '../../src/i18n/pl';
import { pt } from '../../src/i18n/pt';
import { ru } from '../../src/i18n/ru';
import { tr } from '../../src/i18n/tr';
import { frames, openWithSave, selectCargo, snapshot, tapTarget } from './support/game';
import { v2Save } from './support/save';

const SHOTS = 'test-results/languages';
const DICTS: Record<Lang, Record<TextKey, string>> = { en, tr, de, es, fr, it: itDict, pl, pt, ru, id };
const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 412, height: 915 },
];

/** What a layout check found wrong: the element, its text and the problem. */
interface Offence {
  where: string;
  text: string;
  problem: string;
}

/**
 * Runs in the page: every visible element under #ui-root (and the save
 * messages beside it) is checked.
 * - text boxes (block-level elements with their own text): content no wider
 *   than the box, and the box inside the viewport horizontally (and
 *   vertically unless it scrolls inside a panel card);
 * - buttons and button-like labels: text neither wider nor taller than the box.
 */
function layoutOffences(): Offence[] {
  const out: Offence[] = [];
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const describe = (e: Element) => {
    const role = (e as HTMLElement).dataset?.role;
    const cls = typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/).join('.')}` : '';
    return `${e.tagName.toLowerCase()}${cls}${role ? `[data-role=${role}]` : ''}`;
  };
  const shown = (e: Element) => {
    for (let n: Element | null = e; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      if ((n as HTMLElement).hidden) return false;
    }
    return e.getClientRects().length > 0;
  };
  const ownText = (e: Element) =>
    [...e.childNodes]
      .filter((c) => c.nodeType === Node.TEXT_NODE)
      .map((c) => c.textContent ?? '')
      .join('')
      .trim();
  const inScroller = (e: Element) => !!e.closest('.card');
  const roots = [document.getElementById('ui-root'), ...document.querySelectorAll('.save-modal, .save-banner, .notice')];
  const seen = new Set<Element>();
  for (const root of roots) {
    if (!root) continue;
    for (const e of root.querySelectorAll<HTMLElement>('*')) {
      if (seen.has(e)) continue;
      seen.add(e);
      if (e instanceof SVGElement || !shown(e)) continue;
      const cs = getComputedStyle(e);
      const text = ownText(e) || (e.tagName === 'BUTTON' ? (e.textContent ?? '').trim() : '');
      if (!text) continue;
      const r = e.getBoundingClientRect();
      const label = { where: describe(e), text: text.slice(0, 80) };
      if (cs.display !== 'inline') {
        if (e.scrollWidth > e.clientWidth + 1) {
          out.push({ ...label, problem: `content ${e.scrollWidth}px wider than its box ${e.clientWidth}px` });
        }
        // Level tiles hold a number and a star row, no words: not a label.
        if (e.tagName === 'BUTTON' && !e.classList.contains('tile') && e.scrollHeight > e.clientHeight + 1) {
          out.push({ ...label, problem: `content ${e.scrollHeight}px taller than its box ${e.clientHeight}px` });
        }
      }
      if (r.left < -1 || r.right > vw + 1) {
        out.push({ ...label, problem: `box ${Math.round(r.left)}..${Math.round(r.right)} outside 0..${vw}` });
      }
      if (!inScroller(e) && (r.top < -1 || r.bottom > vh + 1)) {
        out.push({ ...label, problem: `box ${Math.round(r.top)}..${Math.round(r.bottom)} outside 0..${vh} vertically` });
      }
    }
  }
  return out;
}

/** Waits until no finite CSS animation or transition is running (screen fades, panel pops). */
async function settled(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => {
      const iterations = a.effect?.getTiming().iterations ?? 1;
      return iterations === Infinity || a.playState !== 'running';
    }),
  );
}

async function checkLayout(page: Page, name: string, opts: { settle?: boolean } = {}) {
  if (opts.settle !== false) await settled(page);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  const offences = await page.evaluate(layoutOffences);
  expect(offences, `${name}: layout`).toEqual([]);
}

/** Waits for the open panel's card to finish popping in. */
async function panelSettled(page: Page) {
  await expect(page.locator('.modal.on')).toHaveCount(1);
  await page.waitForFunction(() => {
    const card = document.querySelector('.modal.on .card');
    return !!card && new DOMMatrix(getComputedStyle(card).transform).a === 1;
  });
}

/** Selects `cargo` and taps it onto a slot, then waits for the game to report it placed. */
async function tapPlace(page: Page, cargo: number, t: { shelf: number; slot: number; slots: number }) {
  await selectCargo(page, cargo);
  await tapTarget(page, t);
  await expect
    .poll(async () => (await snapshot(page)).placements.some((p) => p.id === cargo && p.slot === t.slot), {
      timeout: 60_000,
    })
    .toBe(true);
}

for (const lang of LANGUAGES) {
  const tx = DICTS[lang];
  for (const vp of VIEWPORTS) {
    const tag = `${lang}-${vp.width}x${vp.height}`;
    test(`${tag}: menu, settings, level select, HUD + hazard, pause, loss and win fit`, async ({ browser, baseURL }) => {
      test.slow();
      const save = v2Save((d) => {
        d.settings.renderMode = '2d';
        d.settings.language = lang;
        d.tutorial.skipped = true;
        d.tutorial.seenCargo = ['heavy', 'fragile', 'long', 'priority'];
        d.campaign.stars = { 1: 3, 2: 2, 3: 1 };
        d.endless[String(RULESET_VERSION)] = { bestScore: 124800, bestWave: 17, runs: 6 };
        d.endless[String(RULESET_VERSION - 1)] = { bestScore: 98760, bestWave: 23, runs: 3 };
      });
      const { context, page, errors } = await openWithSave(browser, baseURL, save, undefined, { viewport: vp });

      // --- main menu ------------------------------------------------------------
      await page.goto('/?e2e');
      await expect(page.locator('.menu [data-role="endless"]')).toHaveText(tx['menu.endless'], { timeout: 90_000 });
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(lang);
      await frames(page, 10);
      await checkLayout(page, `${tag}-menu`);
      // The longest label that button can carry: CONTINUE SHIFT - WAVE n (a saved Endless shift).
      await page.evaluate(
        (label) => ((document.querySelector('.menu [data-role="play"]') as HTMLElement).textContent = label),
        tx['menu.continueShift'].replace('{n}', '17'),
      );
      await checkLayout(page, `${tag}-menu-shift`);

      // --- settings with the language list open ------------------------------
      await page.locator('.menu [data-role="settings"]').click();
      await panelSettled(page);
      const toggle = page.locator('.modal [data-role="language-toggle"]');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const list = page.locator('.modal [data-role="language"]');
      await expect(list).toBeVisible();
      await expect(list.locator('[role="radio"]')).toHaveCount(LANGUAGES.length + 1);
      await expect(list.locator(`[data-value="${lang}"]`)).toHaveAttribute('aria-checked', 'true');
      await expect(list.locator(`[data-value="${lang}"]`)).toBeFocused();
      await checkLayout(page, `${tag}-settings-languages`);
      // Escape closes only the list; the panel stays.
      await page.keyboard.press('Escape');
      await expect(list).toBeHidden();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('.modal.settings')).toHaveCount(1);
      await page.locator('.modal [data-role="close-settings"]').click();
      await expect(page.locator('.modal')).toHaveCount(0);

      // --- level select -------------------------------------------------------------
      await page.locator('.menu [data-role="levels"]').dispatchEvent('click');
      await expect(page.locator('.levels .head h1')).toHaveText(tx['levels.title']);
      await frames(page, 5);
      await checkLayout(page, `${tag}-levels`);

      // --- level 4: HUD with the hazard banner ------------------------------------------
      await page.locator('[data-level="4"]').dispatchEvent('click');
      await expect(page.locator('.hud .title')).toHaveText(tx['hud.level'].replace('{n}', '4'), { timeout: 60_000 });
      await page.waitForFunction(() => !!window.__cargoPanic);
      await frames(page, 5);
      await tapPlace(page, 0, { shelf: 0, slot: 4, slots: 1 }); // a heavy crate at the far end tips the rack
      const banner = page.locator('.hazard.on');
      await expect(banner).toContainText(tx['hazard.balance']);
      // Paused at once (the countdown is 3 s): the board, the banner and its countdown freeze under the panel.
      await page.keyboard.press('Escape');
      await expect(page.locator('.modal .headline')).toHaveText(tx['pause.title']);
      await panelSettled(page);
      await expect(banner).toBeVisible();

      // --- HUD + hazard banner: the pause panel hidden for a moment -------------------------
      await page.evaluate(() => document.querySelectorAll<HTMLElement>('.modal').forEach((m) => (m.style.visibility = 'hidden')));
      await page.waitForFunction(() => {
        const b = document.querySelector('.hazard.on');
        if (!b) return false;
        const cs = getComputedStyle(b);
        return cs.opacity === '1' && new DOMMatrix(cs.transform).a === 1;
      });
      // No settling: the danger vignette and the banner pulse run for as long as the danger does.
      await checkLayout(page, `${tag}-hud-hazard`, { settle: false });
      await page.evaluate(() => document.querySelectorAll<HTMLElement>('.modal').forEach((m) => (m.style.visibility = '')));

      // --- pause ---------------------------------------------------------------------------
      await checkLayout(page, `${tag}-pause`, { settle: false });
      await page.locator('.modal [data-role="resume"]').click();
      await expect(page.locator('.modal')).toHaveCount(0);

      // --- loss: the rack collapses -------------------------------------------------------
      await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).toBe('failed');
      await expect(page.locator('.modal .headline')).toHaveText(tx['fail.collapse.title'], { timeout: 30_000 });
      await expect(page.locator('.modal [data-role="fail-detail"]')).toBeVisible();
      await panelSettled(page);
      await checkLayout(page, `${tag}-loss`);

      // --- win: level 1 ----------------------------------------------------------------------
      await page.goto('/?e2e');
      await expect(page.locator('.menu [data-role="play"]')).toBeVisible({ timeout: 90_000 });
      await page.locator('.menu [data-role="levels"]').dispatchEvent('click');
      await page.locator('[data-level="1"]').dispatchEvent('click');
      await expect(page.locator('.hud .title')).toHaveText(tx['hud.level'].replace('{n}', '1'), { timeout: 60_000 });
      await page.waitForFunction(() => !!window.__cargoPanic);
      await frames(page, 5);
      await tapPlace(page, 0, { shelf: 0, slot: 1, slots: 1 });
      await tapPlace(page, 1, { shelf: 0, slot: 3, slots: 1 });
      await expect(page.locator('.modal .headline')).toHaveText(tx['win.headline'], { timeout: 30_000 });
      await expect(page.locator('.modal [data-role="next"]')).toBeVisible();
      await panelSettled(page);
      await page.waitForFunction(() => document.querySelectorAll('.modal .star.pop, .modal .star.off').length === 3);
      await frames(page, 20);
      await checkLayout(page, `${tag}-win`);

      expect(errors).toEqual([]);
      await context.close();
    });
  }
}

test('the language list picks a language with the keyboard and applies it at once', async ({ browser, baseURL }) => {
  const save = v2Save((d) => {
    d.settings.renderMode = '2d';
    d.settings.language = null;
  });
  const { context, page, errors } = await openWithSave(browser, baseURL, save, undefined, { locale: 'pt-PT' });
  await page.goto('/?e2e');
  // A Portugal device follows the device language: Brazilian Portuguese.
  await expect(page.locator('.menu [data-role="endless"]')).toHaveText(pt['menu.endless'], { timeout: 90_000 });
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('pt');
  await page.locator('.menu [data-role="settings"]').click();
  await panelSettled(page);
  const toggle = page.locator('.modal [data-role="language-toggle"]');
  await toggle.focus();
  await page.keyboard.press('Enter');
  const list = page.locator('.modal [data-role="language"]');
  await expect(list.locator('[data-value="system"]')).toBeFocused();
  // System -> Bahasa Indonesia -> Deutsch.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(list.locator('[data-value="de"]')).toBeFocused();
  await page.keyboard.press('Enter');
  // The menu is rebuilt in German with its settings open; the choice is stored.
  await expect(page.locator('.modal .headline')).toHaveText(de['settings.title']);
  await expect(page.locator('.modal [data-role="language-toggle"]')).toHaveText('Deutsch');
  await expect(page.locator('.modal [data-role="language"]')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('de');
  await page.locator('.modal [data-role="close-settings"]').click();
  await expect(page.locator('.menu [data-role="endless"]')).toHaveText(de['menu.endless']);
  await page.reload();
  await expect(page.locator('.menu [data-role="endless"]')).toHaveText(de['menu.endless'], { timeout: 90_000 });
  // Back to SYSTEM: the device language again.
  await page.locator('.menu [data-role="settings"]').click();
  await page.locator('.modal [data-role="language-toggle"]').click();
  await page.locator('.modal [data-role="language"] [data-value="system"]').click();
  await expect(page.locator('.modal .headline')).toHaveText(pt['settings.title']);
  expect(errors).toEqual([]);
  await context.close();
});

test('every level\'s HUD title, name and objective stay above the balance meter in every language (360 x 640)', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const save = v2Save((d) => {
    d.settings.renderMode = '2d';
    d.tutorial.skipped = true;
    d.tutorial.seenCargo = ['heavy', 'fragile', 'long', 'priority'];
  });
  const { context, page, errors } = await openWithSave(browser, baseURL, save, undefined, { viewport: VIEWPORTS[0] });
  await page.goto('/?e2e');
  await expect(page.locator('.menu [data-role="levels"]')).toBeVisible({ timeout: 90_000 });
  await page.locator('.menu [data-role="levels"]').dispatchEvent('click');
  await page.locator('[data-level="1"]').dispatchEvent('click');
  await page.waitForFunction(() => !!window.__cargoPanic);
  await frames(page, 5);
  const texts = LANGUAGES.flatMap((lang) =>
    Array.from({ length: 25 }, (_, i) => {
      const n = i + 1;
      const d = DICTS[lang];
      return {
        lang,
        n,
        title: d['hud.level'].replace('{n}', String(n)),
        name: d[`level.${n}.name` as TextKey],
        objective: d[`level.${n}.objective` as TextKey],
        left: d['hud.left'].replace('{left}', '9').replace('{total}', '9'),
      };
    }),
  );
  const offences = await page.evaluate((all) => {
    const out: string[] = [];
    const hud = document.querySelector<HTMLElement>('.hud')!;
    const meter = document.querySelector<HTMLElement>('.meter')!;
    const [title, subtitle, objective] = hud.firstElementChild!.children as unknown as HTMLElement[];
    const remaining = hud.querySelector<HTMLElement>('.remaining')!;
    for (const x of all) {
      document.documentElement.lang = x.lang;
      title.textContent = x.title;
      subtitle.textContent = x.name;
      objective.textContent = x.objective;
      remaining.textContent = x.left;
      const gap = meter.getBoundingClientRect().top - hud.getBoundingClientRect().bottom;
      if (gap < 0) out.push(`${x.lang} level ${x.n}: HUD reaches ${Math.round(-gap)}px into the meter (${x.name} / ${x.objective})`);
      for (const e of [title, subtitle, objective, remaining]) {
        if (e.scrollWidth > e.clientWidth + 1) out.push(`${x.lang} level ${x.n}: "${e.textContent}" overflows its box`);
      }
    }
    return out;
  }, texts);
  expect(offences).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

for (const mode of ['2d', '3d'] as const) {
  test(`${mode}: canvas-drawn shelf text in Russian (sealed plaque, gold-zone tag) - level 25`, async ({ browser, baseURL }) => {
    test.slow();
    const save = v2Save((d) => {
      d.settings.renderMode = mode;
      d.settings.language = 'ru';
      d.tutorial.skipped = true;
      d.tutorial.seenCargo = ['heavy', 'fragile', 'long', 'priority'];
    });
    const { context, page, errors } = await openWithSave(browser, baseURL, save);
    await page.goto('/?e2e');
    await expect(page.locator('.menu [data-role="levels"]')).toBeVisible({ timeout: 90_000 });
    await page.locator('.menu [data-role="levels"]').dispatchEvent('click');
    await page.locator('[data-level="25"]').dispatchEvent('click');
    await expect(page.locator('.hud .title')).toHaveText(ru['hud.level'].replace('{n}', '25'), { timeout: 60_000 });
    await page.waitForFunction(() => !!window.__cargoPanic);
    const level = await page.evaluate(() => window.__cargoPanic!.board().level);
    expect(level.shelves.some((s) => s.locked)).toBe(true);
    expect(level.shelves.some((s) => !!s.zone)).toBe(true);
    await frames(page, mode === '3d' ? 4 : 20);
    await page.screenshot({ path: `${SHOTS}/ru-${mode}-level25-canvas-text.png` });
    expect(errors).toEqual([]);
    await context.close();
  });
}
