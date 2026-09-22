/**
 * Screen layout shared by both renderers and the input layer. Pure constants,
 * no three.js, so the 2D view and the pointer code can use them without
 * loading the 3D bundle.
 */

import { W3 } from '../game/config';
import type { LevelDef } from '../game/levels/types';

/** Screen fractions (from the top) the rack-and-belt block must stay inside. */
export const FRAME_BAND = {
  /** HUD, meter and banner live above this line. */
  top: 0.31,
  /** The belt's front edge is pinned here; the control bar sits below. */
  bottom: 0.845,
  /** Horizontal margin on each side as a fraction of the width. */
  side: 0.035,
} as const;

/**
 * Bottom fraction of the screen the 3D view treats as "drop it back on the
 * belt". 3D only: the 2D view decides the belt in its own projection (below
 * the rack floor), because this fraction lands on the bottom shelf of several
 * 2D rack shapes. The controller asks the view (dragTarget / targetAt), never
 * this constant.
 */
export const BELT_ZONE_3D = 0.76;

/** Half-width of the rack frame including the uprights, in world units (1 slot = 1 unit). */
export function rackHalfWidth(maxSlots: number): number {
  return (maxSlots * W3.slot) / 2 + W3.frameMargin + 0.11;
}

/** Y of the top of the rack's cap beam, in world units above the floor. */
export function rackTopY(tiers: number): number {
  return W3.shelfBase + (tiers - 1) * W3.tier + W3.cargoH + 0.45;
}

// ---------------------------------------------------------------------------
// Slot hit-testing, in rack-local world units. Both renderers call these, so
// the same on-screen position always resolves to the same (shelf, slot) -
// including the clamp that keeps a long package from hanging off a shelf.
// ---------------------------------------------------------------------------

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

