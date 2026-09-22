/**
 * How the 2D rack leans, as pure functions.
 *
 * The lean angle is the shared one (layout2d.tiltFor, same as the 3D rack),
 * but in a flat front view a rack rotated about its floor centre visibly
 * sinks one foot through the floor. So the 2D rack pivots about the foot on
 * its low side: the rotation is the same (layout2d.toRackLocal /
 * fromRackLocal), followed by the translation that keeps that foot on the
 * floor. Drawing and hit-testing both go through these two functions, so a
 * point on screen always resolves to the same rack-local point the rack is
 * drawn at, and slots are then found with the shared formulas.
 */

import { fromRackLocal, toRackLocal } from './layout2d';
import type { Point } from './layout2d';

/** World offset (units) that puts the low-side foot of a rack leaning by `tilt` back on the floor. */
export function leanOffset(tilt: number, halfWidth: number): Point {
  if (tilt === 0) return { x: 0, y: 0 };
  // Counter-clockwise (tilt > 0) lowers the left foot; clockwise lowers the right one.
  const foot = tilt > 0 ? -halfWidth : halfWidth;
  return { x: foot * (1 - Math.cos(tilt)), y: -foot * Math.sin(tilt) };
}

/** Rack-local point -> world point for a rack leaning by `tilt` on its low-side foot. */
export function rackToWorld(local: Point, tilt: number, halfWidth: number): Point {
  const r = fromRackLocal(local, tilt);
  const o = leanOffset(tilt, halfWidth);
  return { x: r.x + o.x, y: r.y + o.y };
}

/** World point -> rack-local point; the exact inverse of rackToWorld. */
export function worldToRack(world: Point, tilt: number, halfWidth: number): Point {
  const o = leanOffset(tilt, halfWidth);
  return toRackLocal({ x: world.x - o.x, y: world.y - o.y }, tilt);
}
