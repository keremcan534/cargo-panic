/**
 * Records every clip (marketing/out/clips/<name>/NNNN.jpg + clip.json) and
 * the menu screenshots with the rectangles of the buttons that get tapped
 * (marketing/out/menus/*.png + menus.json).
 *
 *   npx tsx marketing/capture.ts               # everything
 *   npx tsx marketing/capture.ts hook-l25 menus  # some
 *
 * Needs a current `npm run build` (dist/).
 */

import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSave, Director, launch, MARKETING, servePreview } from './capture/director';
import { CLIPS, resume } from './capture/clips';
import { campaignActive, campaignSolution } from './capture/setup';

type Rect = { x: number; y: number; width: number; height: number };

/** Title, level select, a level and its pause panel, as a player reaches them, with the tapped buttons' rectangles. */
async function menus(d: Director) {
  const out = join(MARKETING, 'out', 'menus');
  const taps: Record<string, Rect> = {};
  await d.waitFor('.menu [data-role="play"]');
  await d.step(45);
  await d.still(join(out, 'title.png'));
  taps.levels = await d.rectOf('.menu [data-role="levels"]');
  taps.play = await d.rectOf('.menu [data-role="play"]');
  await d.tapSelector('.menu [data-role="levels"]');
  await d.waitFor('[data-level="16"]');
  await d.step(30);
  await d.still(join(out, 'levels.png'));
  taps.level = await d.rectOf('[data-level="16"]');
  await d.tapSelector('[data-level="16"]');
  await d.until(async () => (await d.page.locator('.hud .title').count()) > 0, 300, 'level 16');
  await d.until(async () => (await d.page.locator('.tip').count()) === 0, 400, 'tip card gone');
  await d.step(20);
  await d.still(join(out, 'level16.png'));
  taps.pause = await d.rectOf('[data-icon="pause"]');
  await d.tapSelector('[data-icon="pause"]');
  await d.waitFor('[data-role="resume"]');
  await d.step(20);
  await d.still(join(out, 'pause.png'));
  taps.view2d = await d.rectOf('[data-role="view"] [data-value="2d"]');
  writeFileSync(join(out, 'menus.json'), JSON.stringify({ phone: { width: 412, height: 915 }, taps }, null, 1));
}

async function main() {
  const only = process.argv.slice(2);
  const browser = await launch();
  const server = await servePreview();
  try {
    const want = (n: string) => !only.length || only.includes(n);
    if (want('menus')) {
      const t0 = Date.now();
      // A player partway through the campaign: levels 1-15 cleared, most with three stars.
      const save = buildSave((s) => {
        for (let id = 1; id <= 15; id++) s.campaign.stars[id] = id % 4 === 0 ? 2 : 3;
        s.campaign.unlocked = 16;
      });
      const d = await Director.open(browser, server.url, save);
      await menus(d);
      await d.close();
      console.log(`menus: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    if (want('titles')) {
      // The title screen as a new player sees it, in both views (end card).
      for (const mode of ['3d', '2d'] as const) {
        const d = await Director.open(browser, server.url, buildSave((s) => (s.settings.renderMode = mode)));
        await d.waitFor('.menu [data-role="play"]');
        await d.step(60);
        await d.still(join(MARKETING, 'out', 'menus', `title-${mode}.png`));
        await d.close();
      }
      console.log('titles: done');
    }
    if (want('feature')) {
      // A clean in-engine shot for the feature graphic: level 25 nearly stowed, the
      // game's own 3D view at a landscape size, with the DOM interface hidden.
      const save = buildSave((s) => (s.active = campaignActive(25, campaignSolution(25).slice(0, 8))));
      const d = await Director.open(browser, server.url, save);
      await resume(d); // at phone size: the menu is not laid out for landscape
      await d.page.setViewportSize({ width: 1024, height: 500 });
      await d.page.addStyleTag({ content: '#ui-root, #flash, #fade { display: none !important; }' });
      await d.step(40);
      await d.still(join(MARKETING, 'out', 'menus', 'feature.png'));
      await d.close();
      console.log('feature: done');
    }
    for (const c of CLIPS) {
      if (!want(c.name)) continue;
      const t0 = Date.now();
      rmSync(join(MARKETING, 'out', 'clips', c.name), { recursive: true, force: true });
      const d = await Director.open(browser, server.url, c.save, c.query);
      try {
        await c.play(d);
      } finally {
        await d.close();
      }
      console.log(`${c.name}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  } finally {
    server.stop();
    await browser.close();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
