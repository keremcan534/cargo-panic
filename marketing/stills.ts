/**
 * Store images, in fastlane's supply layout (fastlane/metadata/android/<locale>/images/):
 *   phoneScreenshots/N_<locale>.jpg  1920 x 1080, a game frame and a headline
 *   featureGraphic.jpg                1024 x 500, an in-engine shot and the wordmark
 *   icon.png                          512 x 512, the game's mark
 *
 *   npx tsx marketing/stills.ts
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { ROOT } from './capture/director';
import { serveCompose } from './compose/serve';
import { BRAND, STORE } from './config';
import { STORE_SHOTS } from './storyboard';
import { loadClip } from './timeline';

const IMAGES = join(ROOT, 'fastlane', 'metadata', 'android', STORE.locale, 'images');
const TINTS = [BRAND.accent, BRAND.bad, BRAND.warm, BRAND.warm, BRAND.accent, BRAND.good];

/** A clip frame's URL on the compose server; negative frames count from the clip's end. */
function frameUrl(clip: string, frame: number) {
  const n = frame < 0 ? loadClip(clip).frames + frame : frame;
  return `/out/clips/${clip}/${String(n).padStart(4, '0')}.jpg`;
}

async function open(page: Page, url: string, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(url);
  await page.waitForFunction(() => typeof (window as unknown as { renderShot?: unknown }).renderShot === 'function');
}

async function main() {
  mkdirSync(join(IMAGES, 'phoneScreenshots'), { recursive: true });
  const server = await serveCompose();
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  try {
    for (const [i, s] of STORE_SHOTS.entries()) {
      const images =
        'pair' in s.source
          ? s.source.pair.map((p) => frameUrl(p.clip, p.frame))
          : 'clip' in s.source
            ? [frameUrl(s.source.clip, s.source.frame)]
            : [`/out/menus/${s.source.still}.png`];
      await open(page, server.url, STORE.screenshot.width, STORE.screenshot.height);
      await page.evaluate(
        (spec) => (window as unknown as { renderShot(s: unknown): Promise<void> }).renderShot(spec),
        { title: s.title, sub: s.sub, images, crop: s.crop, tint: TINTS[i % TINTS.length], side: i % 2 ? 'left' : 'right' },
      );
      const file = join(IMAGES, 'phoneScreenshots', `${s.file}.jpg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
      console.log(file);
    }

    await open(page, server.url, STORE.feature.width, STORE.feature.height);
    await page.evaluate(() => (window as unknown as { renderFeature(s: string): Promise<void> }).renderFeature('/out/menus/feature.png'));
    await page.screenshot({ path: join(IMAGES, 'featureGraphic.jpg'), type: 'jpeg', quality: 92 });

    await open(page, server.url, STORE.icon, STORE.icon);
    await page.evaluate(() => (window as unknown as { renderIcon(): Promise<void> }).renderIcon());
    await page.screenshot({ path: join(IMAGES, 'icon.png'), type: 'png', omitBackground: false });
    console.log(`feature graphic and icon in ${IMAGES}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

