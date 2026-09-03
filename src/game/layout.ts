/**
 * The stage is 720 logical pixels wide and flexes in height to match the
 * device aspect ratio, so a tall Android phone fills its screen instead of
 * being letterboxed. Every screen asks this module where things go rather than
 * hard-coding y values.
 */

import { GAME_W, PKG_H, SHELF_SPACING, SLOT_W } from './config';

export interface Layout {
  w: number;
  h: number;
  hudTop: number;
  hudH: number;
  meterY: number;
  meterH: number;
  /** Y of the top surface of the bottom shelf. */
  rackBaseY: number;
  /** Y of the belt's top surface - cargo rests on this line. */
  conveyorY: number;
  /** Thickness of the belt strip drawn below that line. */
  conveyorH: number;
  hintY: number;
  /** Uniform scale applied to the rack so short racks still fill the screen. */
  rackScale: number;
}

/** Vertical extent of a rack above and below its base line, at scale 1. */
export function rackExtent(tiers: number) {
  const above = (tiers - 1) * SHELF_SPACING + PKG_H + 30;
  const below = 64;
  return { above, below, total: above + below };
}

/** Half-width to the shelf brackets, at scale 1. */
export function rackHalfWidth(maxSlots: number) {
  return (maxSlots * SLOT_W) / 2 + 22;
}

/** Extra half-width taken by the uprights, top cap and foot plates. */
export const RACK_FRAME_MARGIN = 36;

const LS_COLS = 5;
const LS_ROWS = 5;
const LS_TILE = 118;
const LS_GAP = 18;
const LS_HEADER_BOTTOM = 150;

export interface GridGeometry {
  cols: number;
  rows: number;
  tile: number;
  colGap: number;
  rowGap: number;
  x0: number;
  y0: number;
  footerTop: number;
}

/**
 * Level-select grid placement. Row spacing stretches to fill a tall screen so
 * the grid never ends up stranded at one end of the page.
 */
export function gridGeometry(h: number): GridGeometry {
  const footerTop = h - 190;
  const avail = footerTop - LS_HEADER_BOTTOM;
  const raw = (avail - LS_ROWS * LS_TILE) / (LS_ROWS - 1);
  const rowGap = Math.max(LS_GAP, Math.min(52, raw));
  const gridH = LS_ROWS * LS_TILE + (LS_ROWS - 1) * rowGap;
  const gridW = LS_COLS * LS_TILE + (LS_COLS - 1) * LS_GAP;
  return {
    cols: LS_COLS,
    rows: LS_ROWS,
    tile: LS_TILE,
    colGap: LS_GAP,
    rowGap,
    x0: (GAME_W - gridW) / 2 + LS_TILE / 2,
    y0: LS_HEADER_BOTTOM + Math.max(0, (avail - gridH) / 2) + LS_TILE / 2,
    footerTop,
  };
}

export function computeLayout(h: number, tiers: number, maxSlots = 7): Layout {
  const hudTop = 18;
  const hudH = 92;
  const meterY = hudTop + hudH + 14;
  const meterH = 74;

  const hintY = h - 60;
  const conveyorH = 52;
  const conveyorY = h - 158;

  const bandTop = meterY + meterH + 18;
  const bandBottom = conveyorY - 96;
  const ext = rackExtent(tiers);
  const bandH = Math.max(1, bandBottom - bandTop);

  // A two-package tutorial rack would look lost on a tall phone, so short racks
  // are scaled up until they either fill the band or run out of screen width.
  const byHeight = bandH / ext.total;
  const byWidth = (GAME_W - 12) / ((rackHalfWidth(maxSlots) + RACK_FRAME_MARGIN) * 2);
  const rackScale = Math.max(1, Math.min(byHeight, byWidth, 1.35));

  // Sit the rack slightly low in its band so it reads as standing on the floor.
  const slack = Math.max(0, bandH - ext.total * rackScale);
  const rackBaseY = bandTop + slack * 0.62 + ext.above * rackScale;

  return {
    w: GAME_W,
    h,
    hudTop,
    hudH,
    meterY,
    meterH,
    rackBaseY,
    conveyorY,
    conveyorH,
    hintY,
    rackScale,
  };
}
