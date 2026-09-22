/**
 * Geometry of the 2D front view, as pure functions.
 *
 * The 2D world uses the same units as the 3D one - one slot is one unit, the
 * floor is y = 0, the rack is centred on x = 0, y points up - so the slot maths
 * (which slot a point falls in, which shelf is nearest) is literally the same
 * formula the 3D rack uses. Only the projection differs: 2D is an orthographic
 * front view scaled to fit the same screen band the 3D camera is solved for.
 *
 * No DOM here, so the hit-testing is unit-tested headless.
 */

import { MAX_TILT_DEG, W3 } from '../../game/config';
import { PACKAGE_SPECS } from '../../game/levels/types';
import type { LevelDef, PackageType } from '../../game/levels/types';
import type { SlotTarget } from '../../game/session/types';
import { FRAME_BAND, rackHalfWidth, rackTopY } from '../layout';

/** The belt sits below the rack floor in the front view. */
export const BELT_2D = {
  /** Y of the belt's top surface. */
  topY: -0.9,
  /** Visual thickness of the belt. */
  height: 0.32,
  /** Scale of the two "up next" packages. */
  queuedScale: 0.86,
} as const;

export interface Layout2D {
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  /** CSS pixels per world unit. */
  scale: number;
  /** Screen position of the world origin (floor, rack centre). */
  originX: number;
  floorY: number;
  halfWidth: number;
  rackTop: number;
  /** World x of the live belt package and the two queued ones. */
  liveX: number;
  queueX: [number, number];
  /** World y of the centre of a package resting on the belt. */
  beltCargoY: number;
}

/** Lowest world y the play block occupies (belt underside). */
const BELT_BOTTOM = BELT_2D.topY - BELT_2D.height;

export function layout2d(width: number, height: number, tiers: number, maxSlots: number): Layout2D {
  const halfWidth = rackHalfWidth(maxSlots);
  const rackTop = rackTopY(tiers);
  const bandTop = FRAME_BAND.top * height;
  const bandBottom = FRAME_BAND.bottom * height;
  const usableW = (1 - 2 * FRAME_BAND.side) * width;
  // The belt carries queued cargo to the right of the rack's centre line; give it the same width budget.
  const blockW = halfWidth * 2;
  const blockH = rackTop - BELT_BOTTOM;
  const scale = Math.max(1, Math.min(usableW / blockW, (bandBottom - bandTop) / blockH));
  // Like the 3D framing: the belt's lower edge is pinned to the bottom of the band.
  const floorY = bandBottom + BELT_BOTTOM * scale;
  return {
    width,
    height,
    scale,
    originX: width / 2,
    floorY,
    halfWidth,
    rackTop,
    liveX: -halfWidth * 0.5,
    queueX: [halfWidth * 0.18, halfWidth * 0.68],
    beltCargoY: BELT_2D.topY + W3.cargoH / 2,
  };
}

export interface Point {
  x: number;
  y: number;
}

export function toScreen(L: Layout2D, x: number, y: number): Point {
  return { x: L.originX + x * L.scale, y: L.floorY - y * L.scale };
}

export function toWorld(L: Layout2D, px: number, py: number): Point {
  return { x: (px - L.originX) / L.scale, y: (L.floorY - py) / L.scale };
}

/**
 * Rack lean in radians for a net torque, identical to the 3D rack: a positive
 * net (heavier right) leans the top to the right, up to MAX_TILT_DEG at twice
 * the tolerance. Counter-clockwise positive, y up.
 */
export function tiltFor(net: number, tolerance: number): number {
  const ratio = Math.max(-1, Math.min(1, net / (Math.max(tolerance, 0.001) * 2)));
  return -ratio * MAX_TILT_DEG * (Math.PI / 180);
}

/** World point -> rack-local point, undoing a lean about the floor pivot. */
export function toRackLocal(p: Point, tilt: number): Point {
  const c = Math.cos(-tilt);
  const s = Math.sin(-tilt);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Rack-local point -> world point, applying the lean. */
export function fromRackLocal(p: Point, tilt: number): Point {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function shelfSurfaceY(tier: number): number {
  return W3.shelfBase + tier * W3.tier;
}

/** Centre y of cargo resting on a tier (same as Shelf3D.cargoCentreY). */
export function cargoCentreY(tier: number): number {
  return shelfSurfaceY(tier) + W3.cargoH / 2 + 0.005;
}

/** Centre x of a package `slots` wide starting at `slot` (same as Shelf3D.slotCentreX). */
export function slotCentreX(shelfSlots: number, slot: number, slots: number): number {
  return (slot + slots / 2 - shelfSlots / 2) * W3.slot;
}

/** Slot a package `slots` wide lands in when centred at localX (same as Shelf3D.slotFromX). */
export function slotFromX(shelfSlots: number, localX: number, slots: number): number {
  const raw = localX / W3.slot + shelfSlots / 2 - slots / 2;
  return Math.max(0, Math.min(shelfSlots - slots, Math.round(raw)));
}

/** Nearest tier to a rack-local point, or -1 when far outside the rack (same as Rack3D.nearestShelf). */
export function nearestShelf(level: LevelDef, localX: number, localY: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let t = 0; t < level.shelves.length; t++) {
    const width = level.shelves[t].slots * W3.slot;
    if (Math.abs(localX) > width / 2 + W3.slot * 0.75) continue;
    const d = Math.abs(localY - cargoCentreY(t));
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return bestDist <= W3.tier * 0.72 ? best : -1;
}

/**
 * Semantic target for a package `slots` wide whose centre is at a rack-local
 * point. Legality is NOT decided here - that is the session's job.
 */
export function targetFromLocal(level: LevelDef, local: Point, slots: number): SlotTarget | null {
  const shelf = nearestShelf(level, local.x, local.y);
  if (shelf < 0) return null;
  return { shelf, slot: slotFromX(level.shelves[shelf].slots, local.x, slots) };
}

/** Width in world units of a package's box (same gap as the 3D cargo). */
export function cargoWidth(type: PackageType): number {
  return PACKAGE_SPECS[type].slots * W3.slot - W3.cargoGap;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rack-local box of a stowed package (centre-based rect, y up). */
export function stowedRect(level: LevelDef, type: PackageType, shelf: number, slot: number): Rect {
  const w = cargoWidth(type);
  const cx = slotCentreX(level.shelves[shelf].slots, slot, PACKAGE_SPECS[type].slots);
  return { x: cx - w / 2, y: cargoCentreY(shelf) - W3.cargoH / 2, w, h: W3.cargoH };
}

/** World box of a package on the belt at queue index 0, 1 or 2. */
export function beltRect(L: Layout2D, type: PackageType, index: number): Rect | null {
  if (index > 2) return null;
  const s = index === 0 ? 1 : BELT_2D.queuedScale;
  const w = cargoWidth(type) * s;
  const h = W3.cargoH * s;
  const cx = index === 0 ? L.liveX : L.queueX[index - 1];
  return { x: cx - w / 2, y: BELT_2D.topY, w, h };
}

export function inRect(r: Rect, p: Point, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}
