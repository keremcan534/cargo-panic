/**
 * Scouting: one still per candidate scene, so shots can be chosen before any
 * clip is recorded. `npm run store:explore` -> marketing/out/explore/*.jpg
 */

import { join } from 'node:path';
import { buildSave, Director, launch, MARKETING, servePreview } from './capture/director';
import { campaignActive, campaignSolution, endlessActive, waveSolution } from './capture/setup';

interface Scout {
  name: string;
  save: string;
  query?: string;
  /** From the menu to the shot. */
  go: (d: Director) => Promise<void>;
}

async function resume(d: Director) {
  await d.waitFor('.menu [data-role="play"]');
  await d.tapSelector('.menu [data-role="continue"]');
  await d.waitFor('[data-role="resume"]');
  await d.step(10); // the panel ignores taps while it is still opening
  await d.tapSelector('[data-role="resume"]');
  await d.step(20);
}

const partial = (level: number, n: number) => campaignSolution(level).slice(0, n);

export const SCOUTS: Scout[] = [
  { name: 'menu-3d', save: buildSave(), go: async (d) => { await d.waitFor('.menu [data-role="play"]'); await d.step(45); } },
  { name: 'menu-2d', save: buildSave((s) => (s.settings.renderMode = '2d')), go: async (d) => { await d.waitFor('.menu [data-role="play"]'); await d.step(45); } },
  ...[25, 24, 22, 20, 15, 11].map((id) => ({
    name: `l${id}-mid-3d`,
    save: buildSave((s) => (s.active = campaignActive(id, partial(id, 4)))),
    go: resume,
  })),
  { name: 'l25-mid-2d', save: buildSave((s) => { s.settings.renderMode = '2d'; s.active = campaignActive(25, partial(25, 4)); }), go: resume },
  { name: 'wave12-3d', save: buildSave((s) => (s.active = endlessActive(12345, 12, waveSolution(12345, 12).slice(0, 3), 18450))), go: resume },
  { name: 'wave25-3d', save: buildSave((s) => (s.active = endlessActive(12345, 25, waveSolution(12345, 25).slice(0, 4), 61230))), go: resume },
];

async function main() {
  const only = process.argv.slice(2);
  const browser = await launch();
  const server = await servePreview();
  try {
    for (const s of SCOUTS) {
      if (only.length && !only.includes(s.name)) continue;
      const t0 = Date.now();
      const d = await Director.open(browser, server.url, s.save, s.query);
      await s.go(d);
      await d.still(join(MARKETING, 'out', 'explore', `${s.name}.jpg`));
      await d.close();
      console.log(`${s.name}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
  } finally {
    server.stop();
    await browser.close();
  }
}

void main();
