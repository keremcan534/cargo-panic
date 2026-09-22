/**
 * Screen layout shared by both renderers and the input layer. Pure constants,
 * no three.js, so the 2D view and the pointer code can use them without
 * loading the 3D bundle.
 */

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
