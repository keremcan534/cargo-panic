/**
 * Global tuning constants and the fixed logical resolution everything is laid
 * out against. Phaser scales this 720x1280 portrait stage to fit any device.
 */

/** Logical stage width. Height flexes with the device aspect ratio. */
export const GAME_W = 720;
export const GAME_H_DEFAULT = 1280;
export const GAME_H_MIN = 1120;
export const GAME_H_MAX = 1580;

/** One shelf column. Packages are always an integer number of slots wide. */
export const SLOT_W = 82;
/** Rendered package height. */
export const PKG_H = 72;
/** Vertical gap between shelf surfaces. */
export const SHELF_SPACING = 152;
/** Thickness of the shelf plank itself. */
export const SHELF_THICKNESS = 18;

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

/**
 * How far a dragged package floats above a finger, so cargo stays visible
 * while it is being moved. Zero for mouse input.
 */
export const TOUCH_LIFT = 64;

/** How long the board must sit clean before a completed level is declared won. */
export const WIN_SETTLE_MS = 620;

export const COLORS = {
  bgTop: 0x1b2735,
  bgBottom: 0x090c11,
  floor: 0x131a24,
  frameLight: 0x5c6b80,
  frameDark: 0x2c3644,
  frameEdge: 0x7d8fa8,
  shelfTop: 0x6f8098,
  shelfFace: 0x3d4a5c,
  shelfDark: 0x27303d,
  panel: 0x151d29,
  panelEdge: 0x2e3a4b,
  text: 0xeef4ff,
  textDim: 0x8fa2ba,
  accent: 0x4da3ff,
  accentWarm: 0xf0a53c,
  good: 0x3fd68a,
  warn: 0xf5c451,
  bad: 0xff5f57,
  gold: 0xffc93c,
  zone: 0xffc93c,
  fragileBand: 0x5fb2b6,
  locked: 0x59341f,
} as const;

export const HEX = {
  text: '#eef4ff',
  textDim: '#8fa2ba',
  accent: '#4da3ff',
  accentWarm: '#f0a53c',
  good: '#3fd68a',
  warn: '#f5c451',
  bad: '#ff5f57',
  gold: '#ffc93c',
  dark: '#0d1117',
} as const;

export const FONT = 'Trebuchet MS, Segoe UI, system-ui, sans-serif';
