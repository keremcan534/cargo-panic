/**
 * Offscreen artwork for the 2D view: cargo sprites baked from the shared
 * cargo art (render/art/cargoArt.ts), plus the small vector icons the view
 * uses so that no state is told by colour alone.
 *
 * Cargo is baked in two steps. The type art is drawn once per stage at the 3D
 * texture resolution (so it is literally the same picture as the 3D face),
 * then scaled into a sprite at the current CSS-pixels-per-unit x DPR with the
 * box edges, a soft shadow and a large weight plate on top. Sprites are
 * rebuilt on resize, never per frame.
 */

import { W3 } from '../../game/config';
import { PACKAGE_SPECS } from '../../game/levels/types';
import type { PackageType } from '../../game/levels/types';
import { drawCargoFront, PALETTES, roundRect } from '../art/cargoArt';
import { cargoWidth } from './layout2d';

/** Art resolution per world unit - the same as the 3D textures. */
export const ART_PX = 256;

export const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  return [c, ctx];
}

/** Shrinks a canvas' backing store to nothing so the memory goes at once. */
export function freeCanvas(c: HTMLCanvasElement | null | undefined) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}

/**
 * Resolution-independent cargo faces, one per type (and a cracked fragile
 * face). Owned by the Stage and shared by every view and backdrop on it.
 */
export class ArtCache {
  private faces = new Map<string, HTMLCanvasElement>();

  face(type: PackageType, cracked = false): HTMLCanvasElement {
    const key = cracked ? `${type}!` : type;
    const hit = this.faces.get(key);
    if (hit) return hit;
    const slots = PACKAGE_SPECS[type].slots;
    const [c, ctx] = makeCanvas(ART_PX * (slots - W3.cargoGap), ART_PX * W3.cargoH);
    drawCargoFront(ctx, type, c.width, c.height, cracked);
    this.faces.set(key, c);
    return c;
  }

  dispose() {
    for (const c of this.faces.values()) freeCanvas(c);
    this.faces.clear();
  }
}

export interface CargoSprite {
  canvas: HTMLCanvasElement;
  /** Box size in CSS pixels. */
  w: number;
  h: number;
  /** Transparent margin (CSS px) around the box that holds the shadow. */
  pad: number;
}

/** Weight plate size for a box `h` CSS px tall: never below a finger-readable size. */
export function platePx(h: number): number {
  return Math.max(18, h * 0.44);
}

/**
 * One package as a sprite, `s` CSS px per world unit at `dpr`. The weight
 * plate covers the art's own (small) badge in the same corner and keeps the
 * number at >= 13 CSS px even on a 360 x 640 screen.
 */
export function bakeCargoSprite(art: ArtCache, type: PackageType, cracked: boolean, s: number, dpr: number): CargoSprite {
  const w = cargoWidth(type) * s;
  const h = W3.cargoH * s;
  const pad = Math.max(5, 0.16 * s);
  const [c, ctx] = makeCanvas((w + pad * 2) * dpr, (h + pad * 2) * dpr);
  ctx.scale(dpr, dpr);
  ctx.translate(pad, pad);
  const r = Math.max(2, 0.045 * s);
  const p = PALETTES[type];

  // Soft contact shadow, a little below and to the right.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 0.12 * s * dpr;
  ctx.shadowOffsetX = 0.03 * s * dpr;
  ctx.shadowOffsetY = 0.07 * s * dpr;
  roundRect(ctx, 0, 0, w, h, r);
  ctx.fillStyle = p.dark;
  ctx.fill();
  ctx.restore();

  // The shared face art, scaled down from its 3D texture resolution.
  ctx.save();
  roundRect(ctx, 0, 0, w, h, r);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(art.face(type, cracked), 0, 0, w, h);

  // Box edges: a lit lid, a shaded right side and a dark base so it reads as a box.
  const lid = Math.max(2, 0.06 * s);
  ctx.fillStyle = 'rgba(255,255,255,0.24)';
  ctx.fillRect(0, 0, w, lid);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, lid, w, Math.max(1, 0.012 * s));
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(w - Math.max(2, 0.04 * s), lid, Math.max(2, 0.04 * s), h - lid);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, lid, Math.max(1.5, 0.025 * s), h - lid);
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.fillRect(0, h - Math.max(2, 0.035 * s), w, Math.max(2, 0.035 * s));
  ctx.restore();

  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, r);
  ctx.strokeStyle = 'rgba(8,10,14,0.7)';
  ctx.lineWidth = 1;
  ctx.stroke();

  drawWeightPlate(ctx, type, w, h);
  return { canvas: c, w, h, pad };
}

/** Big weight number in a dark plate, bottom-right, over the art's small badge. */
function drawWeightPlate(ctx: CanvasRenderingContext2D, type: PackageType, w: number, h: number) {
  const p = PALETTES[type];
  const size = platePx(h);
  const inset = Math.max(1.5, h * 0.04);
  const x = w - inset - size;
  const y = h - inset - size;
  roundRect(ctx, x, y, size, size, size * 0.3);
  ctx.fillStyle = 'rgba(9,12,18,0.92)';
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, size * 0.09);
  ctx.strokeStyle = p.accent;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(size * 0.74)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(PACKAGE_SPECS[type].weight), x + size / 2, y + size / 2 + size * 0.04);
}

/** Soft radial glow in one colour (`rgb` as "r,g,b"), for lamps, overload and highlights. */
export function bakeGlow(rgb: string, size = 96): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.5, `rgba(${rgb},0.45)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

// ---------------------------------------------------------------------------
// Icons. Vector paths drawn straight onto the frame (no glyph fonts, so they
// look the same on every device).
// ---------------------------------------------------------------------------

export type IconKind = 'ok' | 'crush' | 'bad' | 'belt' | 'down' | 'hint';

/** Icon inside a dark disc with a coloured ring, centred at (cx, cy), radius r (CSS px). */
export function drawIcon(ctx: CanvasRenderingContext2D, kind: IconKind, cx: number, cy: number, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(9,12,18,0.9)';
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.16);
  ctx.strokeStyle = color;
  ctx.stroke();

  const k = r * 0.52;
  ctx.lineWidth = Math.max(2, r * 0.24);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  switch (kind) {
    case 'ok':
      ctx.moveTo(cx - k * 0.95, cy + k * 0.05);
      ctx.lineTo(cx - k * 0.25, cy + k * 0.72);
      ctx.lineTo(cx + k * 0.95, cy - k * 0.62);
      ctx.stroke();
      break;
    case 'bad':
      ctx.moveTo(cx - k * 0.72, cy - k * 0.72);
      ctx.lineTo(cx + k * 0.72, cy + k * 0.72);
      ctx.moveTo(cx + k * 0.72, cy - k * 0.72);
      ctx.lineTo(cx - k * 0.72, cy + k * 0.72);
      ctx.stroke();
      break;
    case 'crush':
      // Exclamation mark.
      ctx.moveTo(cx, cy - k * 0.95);
      ctx.lineTo(cx, cy + k * 0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + k * 0.78, Math.max(1.2, r * 0.15), 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'belt':
      // Return arrow: down and to the left, onto the belt.
      ctx.moveTo(cx + k * 0.8, cy - k * 0.8);
      ctx.lineTo(cx + k * 0.8, cy + k * 0.15);
      ctx.lineTo(cx - k * 0.55, cy + k * 0.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - k * 0.95, cy + k * 0.15);
      ctx.lineTo(cx - k * 0.3, cy - k * 0.45);
      ctx.lineTo(cx - k * 0.3, cy + k * 0.75);
      ctx.closePath();
      ctx.fill();
      break;
    case 'down':
      ctx.moveTo(cx, cy - k * 0.9);
      ctx.lineTo(cx, cy + k * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - k * 0.75, cy + k * 0.05);
      ctx.lineTo(cx, cy + k * 0.95);
      ctx.lineTo(cx + k * 0.75, cy + k * 0.05);
      ctx.stroke();
      break;
    case 'hint':
      // Light bulb: globe, neck and base.
      ctx.arc(cx, cy - k * 0.25, k * 0.62, Math.PI * 0.8, Math.PI * 2.2);
      ctx.lineTo(cx + k * 0.28, cy + k * 0.45);
      ctx.lineTo(cx - k * 0.28, cy + k * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - k * 0.3, cy + k * 0.58, k * 0.6, k * 0.34);
      break;
  }
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

/** Diagonal hatch inside a rect (for "refused" and "danger" ghosts). */
export function hatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, gap: number, color: string, cross: boolean) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, gap * 0.28);
  ctx.beginPath();
  for (let d = -h; d < w + h; d += gap) {
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
    if (cross) {
      ctx.moveTo(x + d, y);
      ctx.lineTo(x + d + h, y + h);
    }
  }
  ctx.stroke();
  ctx.restore();
}
