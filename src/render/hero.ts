/**
 * The title screen's hero rack: one shape and one set of cargo, drawn by the
 * 3D menu backdrop (three/backdrops.ts) and the 2D one (canvas2d/backdrops2d.ts),
 * its sway, and the one rule both views use to fit it into the space the
 * menu's text and buttons leave free (`fitHero`).
 *
 * Plain data and maths with no renderer imports, so the 2D path can use it
 * without loading three.js.
 */

import type { LevelDef, PackageType } from '../game/levels/types';
import { rackHalfWidth, rackTopY } from './layout';
import type { ScreenRect } from './Stage';
import { Easing } from './Tween';

export const HERO_LEVEL: LevelDef = {
  id: 0,
  name: 'HERO',
  objective: '',
  shelves: [
    { slots: 6, maxWeight: 99 },
    { slots: 6, maxWeight: 99 },
  ],
  packages: [],
  balanceTolerance: 99,
};

/** [type, tier, slot] of every package on the hero rack. */
export const HERO_CARGO: readonly (readonly [PackageType, number, number])[] = [
  ['heavy', 1, 0],
  ['standard', 1, 1],
  ['fragile', 1, 3],
  ['standard', 1, 4],
  ['long', 0, 0],
  ['priority', 0, 4],
];

// ---------------------------------------------------------------------------
// Sway
// ---------------------------------------------------------------------------

/** The rack rocks between -HERO_SWAY and +HERO_SWAY radians about its floor pivot. */
export const HERO_SWAY = 0.02;

/** Lean in radians (counter-clockwise, y up) `tMs` into the sway: one swing per 3.2 s, eased. */
export function heroSway(tMs: number): number {
  const phase = (tMs / 3200) % 2;
  return -HERO_SWAY + 2 * HERO_SWAY * Easing.sineInOut(phase < 1 ? phase : 2 - phase);
}

// ---------------------------------------------------------------------------
// Extent
// ---------------------------------------------------------------------------

/** A rack's extent in world units: x about its centre line, y up from the floor. */
export interface HeroBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const HALF_WIDTH = rackHalfWidth(Math.max(...HERO_LEVEL.shelves.map((s) => s.slots)));
const TOP = rackTopY(HERO_LEVEL.shelves.length);

/**
 * The hero rack as the 2D view draws it (rack2d): foot plate to foot plate,
 * and from the bottom shelf's label (it hangs just below the floor line) to
 * the top of the cap beam.
 */
export const HERO_BOX_2D: HeroBox = { x0: -(HALF_WIDTH + 0.2), x1: HALF_WIDTH + 0.2, y0: -0.08, y1: TOP };

/** The same for the 3D rack (Rack3D centres its wider foot plates on the uprights). */
export const HERO_BOX_3D: HeroBox = { x0: -(HALF_WIDTH + 0.31), x1: HALF_WIDTH + 0.31, y0: -0.07, y1: TOP };

/** Depth of the 3D hero rack either side of its centre plane (the foot plates). */
export const HERO_DEPTH_3D = 0.75;

/** The four corners of a box, rotated by `angle` (counter-clockwise, y up) about the floor pivot. */
export function rotatedCorners(box: HeroBox, angle: number): { x: number; y: number }[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [box.x0, box.y0],
    [box.x1, box.y0],
    [box.x0, box.y1],
    [box.x1, box.y1],
  ].map(([x, y]) => ({ x: x * c - y * s, y: x * s + y * c }));
}

/**
 * Everything `box` covers while it sways (any lean up to +-amp). Sampled at
 * both ends and the middle of the swing: for swings this small that is exact
 * to a thousandth of a unit.
 */
export function swayEnvelope(box: HeroBox, amp = HERO_SWAY): HeroBox {
  const out: HeroBox = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const a of [-amp, 0, amp]) {
    for (const p of rotatedCorners(box, a)) {
      out.x0 = Math.min(out.x0, p.x);
      out.x1 = Math.max(out.x1, p.x);
      out.y0 = Math.min(out.y0, p.y);
      out.y1 = Math.max(out.y1, p.y);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fitting the rack between the menu's text and buttons
// ---------------------------------------------------------------------------

/** Space kept between the hero rack and the text above it / the buttons below it, CSS px. */
export const HERO_GAP = 8;

/**
 * Below this fraction of its natural size the rack is too small to read (its
 * weights and shelf labels turn to specks): it is not drawn at all.
 */
export const HERO_MIN_SCALE = 0.45;

/**
 * The free band the title screen leaves for the hero rack: from the bottom
 * of its tagline to the top of its button column, in CSS px from the top of
 * the stage canvas. It spans the full width.
 */
export interface HeroBand {
  top: number;
  bottom: number;
}

/**
 * Where the hero rack is drawn. Both views call this with their own numbers
 * and apply the answer the same way (a uniform scale plus a move of what
 * they would draw anyway), so 2D and 3D follow one rule.
 *
 * `natural` is the rack's screen box, sway included, as the view places it
 * with nothing else on screen. `band` is the free band (null: no
 * constraint). Its top and bottom are text and buttons, so HERO_GAP is kept
 * from them. Its sides are the screen's edges, which each view's own framing
 * already fits the rack's width to - so only the band's height can shrink it.
 *
 * The rack keeps its natural place and size when that fits. Otherwise it
 * moves the least distance up or down into the band, and if it is still too
 * tall it shrinks (never grows) about its centre line and is centred in the
 * band. Returns the box it is drawn into - the same aspect as `natural` - or
 * null when the band would need it smaller than HERO_MIN_SCALE (or there is
 * no band at all): then it is hidden rather than drawn under text.
 */
export function fitHero(natural: ScreenRect, band: HeroBand | null): ScreenRect | null {
  if (!band) return { ...natural };
  const top = band.top + HERO_GAP;
  const bottom = band.bottom - HERO_GAP;
  if (bottom <= top || natural.w <= 0 || natural.h <= 0) return null;
  const k = Math.min(1, (bottom - top) / natural.h);
  if (k < HERO_MIN_SCALE) return null;
  const w = natural.w * k;
  const h = natural.h * k;
  const cx = natural.x + natural.w / 2;
  const cy = Math.max(top + h / 2, Math.min(bottom - h / 2, natural.y + natural.h / 2));
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Same band to a hundredth of a pixel (both null counts as the same). */
export function sameBand(a: HeroBand | null, b: HeroBand | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.top - b.top) < 0.01 && Math.abs(a.bottom - b.bottom) < 0.01;
}
