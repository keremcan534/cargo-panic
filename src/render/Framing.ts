/**
 * Camera framing for a rack of a given size on a screen of a given aspect.
 *
 * Pure maths, no DOM and no renderer, so the same function can be imported by
 * headless tooling to project world points into screen space and drive the
 * real game with synthetic input.
 *
 * The layout is solved against screen-space constraints rather than tuned by
 * hand: the rack must fit the width with a margin, the belt's front edge is
 * pinned to a fixed screen height so the pickup spot never moves between
 * levels, and the rack's top must stay below the HUD band. Distance and
 * camera height are iterated until all three hold.
 */

import { PerspectiveCamera, Vector3 } from 'three';
import { W3 } from '../game/config';

export const CAMERA_FOV = 40;
/** Downward pitch of the camera in degrees. Enough to separate the belt from the rack; shallow enough to keep front labels readable. */
export const CAMERA_PITCH_DEG = 22;

/** Screen fractions (from the top) the rack-and-belt block must stay inside. */
export const FRAME_BAND = {
  /** HUD, meter and banner live above this line. */
  top: 0.31,
  /** The belt's front edge is pinned here; the control bar sits below. */
  bottom: 0.845,
  /** Horizontal margin on each side as a fraction of the width. */
  side: 0.035,
} as const;

export interface Framing {
  position: Vector3;
  target: Vector3;
  /** Rack top edge in world units, handy for placing overlays. */
  rackTop: number;
  distance: number;
}

/** Half-width of the rack frame including the uprights. */
export function rackHalfWidth(maxSlots: number): number {
  return (maxSlots * W3.slot) / 2 + W3.frameMargin + 0.11;
}

/** Y of the top of the rack's cap beam. */
export function rackTopY(tiers: number): number {
  return W3.shelfBase + (tiers - 1) * W3.tier + W3.cargoH + 0.45;
}

/** Front edge of the belt, the lowest point on screen that must stay visible. */
export const BELT_FRONT_Z = W3.beltZ + 1.0;

const VIEW_DIR = new Vector3(
  0,
  -Math.sin(CAMERA_PITCH_DEG * (Math.PI / 180)),
  -Math.cos(CAMERA_PITCH_DEG * (Math.PI / 180)),
);

export function frameCamera(aspect: number, tiers: number, maxSlots: number): Framing {
  const hw = rackHalfWidth(maxSlots);
  const top = rackTopY(tiers);
  const vTan = Math.tan((CAMERA_FOV / 2) * (Math.PI / 180));

  // Points that bound the block on screen: the cap beam's four corners (back
  // ones ride higher under a downward pitch), the belt front, and the rack's
  // front-bottom corners which spread widest under perspective.
  const topPts = [
    new Vector3(-hw, top, W3.plankD / 2),
    new Vector3(hw, top, W3.plankD / 2),
    new Vector3(-hw, top, -W3.plankD / 2),
    new Vector3(hw, top, -W3.plankD / 2),
  ];
  const bottomPt = new Vector3(0, 0, BELT_FRONT_Z);
  const sidePts = [new Vector3(-hw, 0, W3.plankD / 2), new Vector3(hw, 0, W3.plankD / 2), topPts[0], topPts[1]];

  const xLimit = 1 - 2 * FRAME_BAND.side;
  const yTopLimit = 1 - 2 * FRAME_BAND.top;
  const yBotLimit = 1 - 2 * FRAME_BAND.bottom;

  const cam = new PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 120);
  const target = new Vector3(0, top * 0.5, 0);
  let dist = (hw * 1.2) / (vTan * aspect);
  const tmp = new Vector3();

  for (let i = 0; i < 40; i++) {
    cam.position.copy(target).addScaledVector(VIEW_DIR, -dist);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();

    let xMax = 0;
    for (const p of sidePts) xMax = Math.max(xMax, Math.abs(tmp.copy(p).project(cam).x));
    let yTop = -Infinity;
    for (const p of topPts) yTop = Math.max(yTop, tmp.copy(p).project(cam).y);
    const yBot = tmp.copy(bottomPt).project(cam).y;

    const k = Math.max(xMax / xLimit, (yTop - yBot) / (yTopLimit - yBotLimit));
    const nextDist = dist * (1 + (k - 1) * 0.85);
    // Pin the belt front to the band's bottom line.
    const nextY = target.y + (yBot - yBotLimit) * dist * vTan * 0.85;
    const settled = Math.abs(nextDist - dist) < 1e-4 && Math.abs(nextY - target.y) < 1e-4;
    dist = nextDist;
    target.y = nextY;
    if (settled) break;
  }

  return {
    position: target.clone().addScaledVector(VIEW_DIR, -dist),
    target,
    rackTop: top,
    distance: dist,
  };
}

/** A camera configured for the given framing. */
export function makeCamera(aspect: number, tiers: number, maxSlots: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 120);
  applyFraming(cam, aspect, tiers, maxSlots);
  return cam;
}

export function applyFraming(
  cam: PerspectiveCamera,
  aspect: number,
  tiers: number,
  maxSlots: number,
): Framing {
  const f = frameCamera(aspect, tiers, maxSlots);
  cam.aspect = aspect;
  cam.position.copy(f.position);
  cam.lookAt(f.target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return f;
}

/** World point -> viewport fraction (0..1, y down). */
export function projectToViewport(cam: PerspectiveCamera, p: Vector3): { x: number; y: number } {
  const v = p.clone().project(cam);
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
}
