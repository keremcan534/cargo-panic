/**
 * Screen layout shared by both renderers and the input layer. Pure constants,
 * no three.js, so the 2D view and the pointer code can use them without
 * loading the 3D bundle.
 */

import { W3 } from '../game/config';

/** Screen fractions (from the top) the rack-and-belt block must stay inside. */
export const FRAME_BAND = {
  /** HUD, meter and banner live above this line. */
  top: 0.31,
  /** The belt's front edge is pinned here; the control bar sits below. */
  bottom: 0.845,
  /** Horizontal margin on each side as a fraction of the width. */
  side: 0.035,
} as const;

/** Bottom fraction of the play area that counts as "drop it back on the belt". */
export const BELT_ZONE = 0.76;

/** Half-width of the rack frame including the uprights, in world units (1 slot = 1 unit). */
export function rackHalfWidth(maxSlots: number): number {
  return (maxSlots * W3.slot) / 2 + W3.frameMargin + 0.11;
}

/** Y of the top of the rack's cap beam, in world units above the floor. */
export function rackTopY(tiers: number): number {
  return W3.shelfBase + (tiers - 1) * W3.tier + W3.cargoH + 0.45;
}
