/**
 * Android launcher icons from the game's mark (the crate under the blue lid:
 * index.html's favicon and the store icon drawn by renderIcon in
 * compose/page.ts), rendered in headless Chromium into android/app/src/main/res:
 *
 *   mipmap-<density>/ic_launcher.png             legacy square icon, 48 dp
 *   mipmap-<density>/ic_launcher_round.png       legacy round icon, 48 dp
 *   mipmap-<density>/ic_launcher_foreground.png  adaptive foreground, 108 dp, mark inside the 66 dp safe zone
 *   mipmap-<density>/ic_launcher_background.png  adaptive background, 108 dp, the store icon's dark gradient
 *   mipmap-<density>/ic_launcher_monochrome.png  adaptive monochrome (Android 13 themed icons)
 *
 * plus marketing/out/android-icons-preview.png: every layer under the common
 * launcher masks, for checking by eye.
 *
 *   npm run store:android-icons
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { MARKETING, ROOT } from './capture/director';
import { BRAND } from './config';

const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 } as const;

/**
 * The mark in its own 32-unit space (the same shapes and colours as the store icon).
 * Its visible extent is x 5..27, y 8..25.3: centre (16, 16.65), half-diagonal ~14 units.
 */
const MARK = { cx: 16, cy: 16.65, halfDiagonal: 14 };

function markShapes(mono: boolean) {
  if (mono) {
    // Themed icons use alpha only: the tape shows as a lighter band across the crate.
    return `
    <rect x="6" y="13" width="20" height="11" rx="2" fill="#fff" mask="url(#tape)"/>
    <rect x="5" y="8" width="22" height="3" rx="1.5" fill="#fff"/>`;
  }
  return `
    <ellipse cx="16" cy="24.4" rx="10.5" ry="0.9" fill="#000" opacity=".45"/>
    <rect x="6" y="13" width="20" height="11" rx="2" fill="url(#crate)"/>
    <rect x="14" y="13" width="4" height="11" fill="${BRAND.tape}"/>
    <rect x="5" y="8" width="22" height="3" rx="1.5" fill="${BRAND.accent}"/>`;
}

const DEFS = `<defs>
  <radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#1a2433"/><stop offset="1" stop-color="${BRAND.bg}"/></radialGradient>
  <linearGradient id="crate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6b75a"/><stop offset="1" stop-color="${BRAND.warm}"/></linearGradient>
  <mask id="tape" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="#fff"/><rect x="14" y="13" width="4" height="11" fill="#666"/></mask>
  <filter id="lift" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="0.6" stdDeviation="0.7" flood-color="#000" flood-opacity=".35"/></filter>
</defs>`;

/** The mark scaled so its half-diagonal is `radius` (in the layer's units) and centred at (x, y). */
function placedMark(x: number, y: number, radius: number, mono = false) {
  const s = radius / MARK.halfDiagonal;
  return `<g transform="translate(${x} ${y}) scale(${s}) translate(${-MARK.cx} ${-MARK.cy})">${markShapes(mono)}</g>`;
}

type Layer = 'square' | 'round' | 'foreground' | 'background' | 'monochrome';

/** One layer as an SVG in dp units (48 dp legacy, 108 dp adaptive). */
function layerSvg(layer: Layer): { dp: number; body: string } {
  switch (layer) {
    // Legacy icons: a 44 dp shape with 2 dp for the shadow, the mark well inside it.
    case 'square':
      return {
        dp: 48,
        body: `<rect x="2" y="2" width="44" height="44" rx="7" fill="url(#g)" filter="url(#lift)"/>${placedMark(24, 24, 17)}`,
      };
    case 'round':
      return {
        dp: 48,
        body: `<circle cx="24" cy="24" r="22" fill="url(#g)" filter="url(#lift)"/>${placedMark(24, 24, 17)}`,
      };
    // Adaptive: 108 dp layers; launchers show at least the centre 72 dp and
    // guarantee only the 66 dp circle, so the mark's corners stay within r = 31.
    case 'foreground':
      return { dp: 108, body: placedMark(54, 54, 31) };
    case 'monochrome':
      return { dp: 108, body: placedMark(54, 54, 31, true) };
    case 'background':
      return { dp: 108, body: `<rect width="108" height="108" fill="url(#g)"/>` };
  }
}

function svgDoc(layer: Layer, px: number) {
  const { dp, body } = layerSvg(layer);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dp} ${dp}" width="${px}" height="${px}">${DEFS}${body}</svg>`;
}

async function shoot(page: Page, html: string, w: number, h: number, file: string) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${html}</body></html>`);
  await page.screenshot({ path: file, type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}

/** Every layer at xxxhdpi, and the adaptive icon under circle, squircle and rounded-square masks. */
function previewHtml() {
  const px = 192;
  const cell = (inner: string, label: string) =>
    `<div style="display:inline-block;margin:12px;text-align:center;font:12px sans-serif;color:#ccc">${inner}<br>${label}</div>`;
  const adaptive = (clip: string) =>
    `<div style="width:${px}px;height:${px}px;overflow:hidden;${clip};position:relative">
      <div style="position:absolute;left:${-px * 0.25}px;top:${-px * 0.25}px">${svgDoc('background', px * 1.5)}</div>
      <div style="position:absolute;left:${-px * 0.25}px;top:${-px * 0.25}px">${svgDoc('foreground', px * 1.5)}</div></div>`;
  const safe = `<div style="position:relative;width:${px}px;height:${px}px">${svgDoc('background', px)}
      <div style="position:absolute;inset:0">${svgDoc('foreground', px)}</div>
      <div style="position:absolute;left:${(px * 21) / 108}px;top:${(px * 21) / 108}px;width:${(px * 66) / 108}px;height:${(px * 66) / 108}px;border:1px dashed #f0f;border-radius:50%;box-sizing:border-box"></div></div>`;
  return `<div style="background:#eee;padding:8px">
    ${cell(svgDoc('square', px), 'legacy square')}
    ${cell(svgDoc('round', px), 'legacy round')}
    ${cell(safe, '108 dp layers, 66 dp safe zone')}
    ${cell(adaptive('border-radius:50%'), 'circle mask')}
    ${cell(adaptive('border-radius:30%'), 'squircle-ish mask')}
    ${cell(adaptive('border-radius:12%'), 'rounded square mask')}
    ${cell(`<div style="background:#3a5a40;padding:0">${svgDoc('monochrome', px)}</div>`, 'monochrome')}
  </div><div style="background:#0b0d10;padding:8px">${[48, 72, 96, 144].map((s) => `<span style="margin:10px">${svgDoc('square', s)}</span>`).join('')}</div>`;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  try {
    for (const [density, scale] of Object.entries(DENSITIES)) {
      const dir = join(RES, `mipmap-${density}`);
      mkdirSync(dir, { recursive: true });
      const files: [Layer, string][] = [
        ['square', 'ic_launcher.png'],
        ['round', 'ic_launcher_round.png'],
        ['foreground', 'ic_launcher_foreground.png'],
        ['background', 'ic_launcher_background.png'],
        ['monochrome', 'ic_launcher_monochrome.png'],
      ];
      for (const [layer, name] of files) {
        const px = Math.round(layerSvg(layer).dp * scale);
        await shoot(page, svgDoc(layer, px), px, px, join(dir, name));
      }
      console.log(dir);
    }
    const out = join(MARKETING, 'out');
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width: 1500, height: 400 });
    await page.setContent(`<!doctype html><html><body style="margin:0">${previewHtml()}</body></html>`);
    await page.screenshot({ path: join(out, 'android-icons-preview.png'), fullPage: true });
    console.log(join(out, 'android-icons-preview.png'));
  } finally {
    await browser.close();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
