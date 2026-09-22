/**
 * Global tuning constants: the balance rules the systems and solver share,
 * and the 3D world proportions the renderer lays the rack out with.
 */

/** Each tier above the base adds this much leverage to a package's torque. */
export const TIER_LEVERAGE_STEP = 0.25;

/** Milliseconds of "you can still fix this" before a hazard fails the level. */
export const GRACE_MS = {
  balance: 3000,
  overload: 3000,
  fragile: 3500,
} as const;

/** Imbalance beyond tolerance * this drains the balance grace timer twice as fast. */
export const CRITICAL_RATIO = 1.75;

/** Max degrees the rack leans at full imbalance. */
export const MAX_TILT_DEG = 7.5;

/** A package this heavy or heavier crushes fragile cargo underneath it. */
export const CRUSH_WEIGHT = 4;

/** How long the board must sit clean before a completed level is declared won. */
export const WIN_SETTLE_MS = 620;

/** Longest single step the rules clocks ever take. */
export const MAX_STEP_MS = 50;

/**
 * Most real time one animation frame may charge to the rules clocks. Frames
 * slower than MAX_STEP_MS are sub-stepped so a slow renderer does not buy
 * extra seconds; stalls beyond this (a tab switch that the lifecycle pause
 * missed) are dropped rather than charged.
 */
export const MAX_FRAME_CATCHUP_MS = 250;

/**
 * 3D world units. One slot is one unit wide; everything else is proportioned
 * off that so a level's slot maths maps straight onto rack-local coordinates.
 */
export const W3 = {
  slot: 1,
  /** Vertical spacing between shelf surfaces. */
  tier: 1.55,
  /** Height of the bottom shelf surface above the floor. */
  shelfBase: 0.5,
  plankH: 0.14,
  plankD: 1.25,
  cargoH: 0.86,
  cargoD: 0.95,
  /** Horizontal breathing room between neighbouring cargo. */
  cargoGap: 0.1,
  /** Uprights sit this far outside the widest shelf. */
  frameMargin: 0.22,
  /** The belt runs in front of the rack, nearer the camera. */
  beltZ: 4.4,
  beltH: 0.22,
  /** Plane the cargo is dragged in, just in front of the shelves. */
  dragZ: 0.55,
  /** World-unit lift above a finger while dragging on touch. */
  touchLift: 0.9,
} as const;
