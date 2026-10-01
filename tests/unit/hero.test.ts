/**
 * The title screen's hero rack: the fit rule both views use to keep it in the
 * band between the tagline and the buttons, and the sway envelope that rule
 * is given.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  HERO_BOX_2D,
  HERO_GAP,
  HERO_MIN_SCALE,
  HERO_SWAY,
  fitHero,
  heroSway,
  rotatedCorners,
  sameBand,
  swayEnvelope,
} from '../../src/render/hero';
import type { HeroBand } from '../../src/render/hero';
import type { ScreenRect } from '../../src/render/Stage';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const inside = (r: ScreenRect, b: HeroBand) =>
  assert.ok(
    r.y >= b.top + HERO_GAP - 1e-9 && r.y + r.h <= b.bottom - HERO_GAP + 1e-9,
    `y ${r.y}..${r.y + r.h} outside ${b.top}..${b.bottom} less the gap`,
  );

// A rack about as the 2D view places it on a 360 x 640 phone.
const natural: ScreenRect = { x: 2, y: 108, w: 356, h: 180 };
const centreX = natural.x + natural.w / 2;

describe('fitHero', () => {
  test('no band: the natural box', () => {
    assert.deepEqual(fitHero(natural, null), natural);
  });

  test('a band that already holds it (tall phones): unchanged', () => {
    assert.deepEqual(fitHero(natural, { top: 60, bottom: 360 }), natural);
  });

  test('never grows in a huge band', () => {
    const r = fitHero(natural, { top: -1000, bottom: 3000 })!;
    assert.deepEqual(r, natural);
  });

  test('room enough but in the way: moves the least distance, same size', () => {
    // The buttons start 20 px above the rack's natural bottom; there is room above it.
    const band = { top: 60, bottom: natural.y + natural.h - 20 };
    const r = fitHero(natural, band)!;
    near(r.w, natural.w);
    near(r.h, natural.h);
    near(r.x, natural.x);
    near(r.y + r.h, band.bottom - HERO_GAP);
    inside(r, band);
  });

  test('too short: shrinks about its centre line to the band, keeps its aspect, centred in it', () => {
    const band = { top: 216, bottom: 324 };
    const r = fitHero(natural, band)!;
    near(r.h, band.bottom - band.top - 2 * HERO_GAP);
    near(r.w / r.h, natural.w / natural.h);
    near(r.x + r.w / 2, centreX);
    near(r.y + r.h / 2, (band.top + band.bottom) / 2);
    inside(r, band);
  });

  test('far too short (CONTINUE on a 360 x 640 phone): hidden', () => {
    assert.equal(fitHero(natural, { top: 216, bottom: 259 }), null);
  });

  test('exactly the smallest readable size is drawn; a pixel less is not', () => {
    const h = natural.h * HERO_MIN_SCALE + 2 * HERO_GAP;
    assert.notEqual(fitHero(natural, { top: 0, bottom: h }), null);
    assert.equal(fitHero(natural, { top: 0, bottom: h - 1 }), null);
  });

  test('no band at all, or text and buttons overlapping (landscape): hidden', () => {
    assert.equal(fitHero(natural, { top: 259, bottom: 259 }), null);
    assert.equal(fitHero(natural, { top: 259, bottom: 219 }), null);
    assert.equal(fitHero(natural, { top: 259, bottom: 259 + 2 * HERO_GAP }), null);
  });

  test('every band that shows it holds it, on its centre line', () => {
    for (let top = 0; top <= 400; top += 37) {
      for (let h = 0; h <= 400; h += 23) {
        const band = { top, bottom: top + h };
        const r = fitHero(natural, band);
        if (!r) continue;
        inside(r, band);
        near(r.x + r.w / 2, centreX);
      }
    }
  });
});

describe('sway', () => {
  test('stays within +-HERO_SWAY and starts at one end', () => {
    near(heroSway(0), -HERO_SWAY);
    near(heroSway(3200), HERO_SWAY);
    for (let t = 0; t < 10_000; t += 97) assert.ok(Math.abs(heroSway(t)) <= HERO_SWAY + 1e-12);
  });

  test('the envelope holds the rack at every lean of the swing', () => {
    const env = swayEnvelope(HERO_BOX_2D);
    for (let i = 0; i <= 40; i++) {
      const a = -HERO_SWAY + (2 * HERO_SWAY * i) / 40;
      for (const p of rotatedCorners(HERO_BOX_2D, a)) {
        assert.ok(p.x >= env.x0 - 1e-3 && p.x <= env.x1 + 1e-3, `x ${p.x} at ${a}`);
        assert.ok(p.y >= env.y0 - 1e-3 && p.y <= env.y1 + 1e-3, `y ${p.y} at ${a}`);
      }
    }
    assert.ok(env.y1 > HERO_BOX_2D.y1 && env.y0 < HERO_BOX_2D.y0, 'the swing lifts a top corner and drops a foot');
  });
});

test('sameBand', () => {
  assert.ok(sameBand(null, null));
  assert.ok(!sameBand(null, { top: 1, bottom: 2 }));
  assert.ok(sameBand({ top: 1, bottom: 2 }, { top: 1.001, bottom: 2 }));
  assert.ok(!sameBand({ top: 1, bottom: 2 }, { top: 1, bottom: 3 }));
});
