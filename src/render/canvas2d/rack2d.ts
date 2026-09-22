/**
 * The rack in the 2D front view: steel uprights, the cap beam with its amber
 * hazard stripe, thick shelf planks with a lit lip, the instrument label under
 * each plank, gold zones, sealed shelves, fragile crush columns and the red
 * overload glow.
 *
 * Everything static is baked into offscreen canvases at the current scale x
 * DPR; a frame only blits them. Drawing happens in rack-local CSS pixels: the
 * caller has already moved the origin to the floor pivot and applied the
 * lean, so +x is right and world y maps to -y * scale.
 */

import { TIER_LEVERAGE_STEP, W3 } from '../../game/config';
import { tierLeverage } from '../../game/levels/types';
import type { LevelDef } from '../../game/levels/types';
import { drawPriorityTag, drawSealedPlaque, drawShelfLabel, roundRect } from '../art/cargoArt';
import { cargoCentreY, rackHalfWidth, rackTopY, shelfSurfaceY, slotCentreX } from '../layout';
import { bakeGlow, freeCanvas, makeCanvas } from './sprites2d';

/** Visual plank thickness below the shelf surface (world units). */
export const PLANK_H = 0.15;
/** Label box under the plank: gap, then height (world units). */
const LABEL_GAP = 0.01;
export const LABEL_H = 0.42;
/**
 * drawShelfLabel pads its art top and bottom (its pill spans 0.22-0.78 of the
 * height); the 2D view shows only this band of the label canvas. That keeps
 * the load text >= 12 CSS px on a 360 x 640 phone with a four-tier rack, and
 * the bottom tier's label clear of the belt, without changing the shared art.
 */
const LABEL_CROP = [0.2, 0.8] as const;

const STEEL_EDGE = 'rgba(12,16,22,0.85)';
const DASH_ZONE = [6, 4];
const DASH_COLUMN = [4, 5];
const NO_DASH: number[] = [];

export interface CrushColumn {
  x: number;
  w: number;
  bottom: number;
  top: number;
}

interface Baked {
  canvas: HTMLCanvasElement;
  /** Placement in rack-local CSS px. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export class RackArt2D {
  readonly level: LevelDef;
  readonly halfWidth: number;
  readonly top: number;
  readonly s: number;
  private dpr: number;

  private frame: Baked;
  private planks: Baked[] = [];
  private labels: (Baked | null)[] = [];
  private loads: number[] = [];
  private decor: (Baked | null)[] = [];
  private tags: (Baked | null)[] = [];
  private glow: HTMLCanvasElement;

  constructor(level: LevelDef, s: number, dpr: number, opts: { labels?: boolean } = {}) {
    this.level = level;
    this.s = s;
    this.dpr = dpr;
    const maxSlots = Math.max(...level.shelves.map((sh) => sh.slots));
    this.halfWidth = rackHalfWidth(maxSlots);
    this.top = rackTopY(level.shelves.length);
    this.frame = this.bakeFrame();
    this.glow = bakeGlow('255,70,60', 64);
    level.shelves.forEach((_, t) => {
      this.planks.push(this.bakePlank(t));
      this.loads.push(-1);
      this.labels.push(opts.labels === false ? null : this.makeLabel(t));
      this.decor.push(this.bakeDecor(t));
      this.tags.push(this.bakeTag(t));
    });
    if (opts.labels !== false) level.shelves.forEach((_, t) => this.setLoad(t, 0));
  }

  // --- baking ---------------------------------------------------------------

  private bake(x0: number, y0: number, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): Baked {
    const s = this.s;
    const [c, ctx] = makeCanvas(w * s * this.dpr, h * s * this.dpr);
    ctx.scale(this.dpr, this.dpr);
    // Paint in rack-local CSS px: origin at the floor pivot, y down.
    ctx.translate(-x0 * s, y0 * s);
    paint(ctx);
    return { canvas: c, x: x0 * s, y: -y0 * s, w: w * s, h: h * s };
  }

  private bakeFrame(): Baked {
    // The layout reserves exactly halfWidth each side, so the uprights' OUTER
    // faces sit there (the 3D rack centres them on it); that keeps the frame
    // inside the side margin on narrow phones.
    const hw = this.halfWidth - 0.11;
    const top = this.top;
    const s = this.s;
    const X = (x: number) => x * s;
    const Y = (y: number) => -y * s;
    return this.bake(-hw - 0.45, top + 0.05, hw * 2 + 0.9, top + 0.2, (ctx) => {
      // Brackets tying each plank back to the uprights.
      this.level.shelves.forEach((sh, t) => {
        const half = sh.slots / 2;
        const y = shelfSurfaceY(t);
        for (const sx of [-1, 1]) {
          const a = sx * half;
          const b = sx * (hw - 0.1);
          if (Math.abs(b) - Math.abs(a) < 0.03) continue;
          const x0 = Math.min(a, b);
          ctx.fillStyle = '#2d3848';
          ctx.fillRect(X(x0), Y(y - 0.02), (Math.abs(b - a)) * s, PLANK_H * 0.8 * s);
          ctx.fillStyle = 'rgba(160,180,205,0.35)';
          ctx.fillRect(X(x0), Y(y - 0.02), Math.abs(b - a) * s, Math.max(1, 0.02 * s));
        }
      });

      // Uprights, feet and bolt holes.
      for (const sx of [-1, 1]) {
        const cx = sx * hw;
        const x0 = X(cx - 0.11);
        const w = 0.22 * s;
        const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
        g.addColorStop(0, '#b3c3d8');
        g.addColorStop(0.35, '#7e8fa5');
        g.addColorStop(1, '#4c596b');
        ctx.fillStyle = g;
        ctx.fillRect(x0, Y(top), w, top * s);
        ctx.strokeStyle = STEEL_EDGE;
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, Y(top) + 0.5, w - 1, top * s - 1);
        ctx.fillStyle = '#1a2230';
        for (let y = 0.6; y < top - 0.4; y += 0.7) {
          ctx.fillRect(X(cx - 0.035), Y(y + 0.05), 0.07 * s, 0.1 * s);
        }
        // Foot plate.
        ctx.fillStyle = '#3b4759';
        roundRect(ctx, X(cx - 0.31), Y(0.09), 0.62 * s, 0.11 * s, 0.02 * s);
        ctx.fill();
        ctx.fillStyle = 'rgba(190,205,225,0.35)';
        ctx.fillRect(X(cx - 0.31), Y(0.09), 0.62 * s, Math.max(1, 0.02 * s));
      }

      // Cap beam with the amber hazard stripe.
      const cx0 = X(-hw - 0.11);
      const cw = (hw * 2 + 0.22) * s;
      const cy0 = Y(top);
      const ch = 0.18 * s;
      const cg = ctx.createLinearGradient(0, cy0, 0, cy0 + ch);
      cg.addColorStop(0, '#c2d0e2');
      cg.addColorStop(0.3, '#8494aa');
      cg.addColorStop(1, '#4b586a');
      ctx.fillStyle = cg;
      ctx.fillRect(cx0, cy0, cw, ch);
      const sy0 = cy0 + ch * 0.3;
      const sh = ch * 0.5;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx0 + 0.2 * s, sy0, cw - 0.4 * s, sh);
      ctx.clip();
      ctx.fillStyle = '#f0a53c';
      ctx.fillRect(cx0, sy0, cw, sh);
      ctx.fillStyle = '#1b2029';
      const step = Math.max(6, 0.32 * s);
      for (let x = cx0 - sh; x < cx0 + cw + sh; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, sy0 + sh);
        ctx.lineTo(x + step * 0.45, sy0 + sh);
        ctx.lineTo(x + step * 0.45 + sh, sy0);
        ctx.lineTo(x + sh, sy0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = STEEL_EDGE;
      ctx.strokeRect(cx0 + 0.5, cy0 + 0.5, cw - 1, ch - 1);
    });
  }

  private bakePlank(t: number): Baked {
    const sw = this.level.shelves[t].slots * W3.slot;
    const y = shelfSurfaceY(t);
    const s = this.s;
    return this.bake(-sw / 2, y, sw, PLANK_H + 0.02, (ctx) => {
      const x0 = (-sw / 2) * s;
      const y0 = -y * s;
      const w = sw * s;
      const h = PLANK_H * s;
      const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
      g.addColorStop(0, '#e2ecf8');
      g.addColorStop(0.2, '#a9bbd0');
      g.addColorStop(0.26, '#7f90a6');
      g.addColorStop(1, '#4f5d71');
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, w, h);
      // Dark underside so the plank separates from the label.
      ctx.fillStyle = '#1b222d';
      ctx.fillRect(x0, y0 + h, w, Math.max(1, 0.02 * s));
      // End caps and rivets.
      ctx.fillStyle = 'rgba(20,26,36,0.55)';
      const cap = Math.max(2, 0.07 * s);
      ctx.fillRect(x0, y0, cap, h);
      ctx.fillRect(x0 + w - cap, y0, cap, h);
      ctx.fillStyle = 'rgba(230,240,255,0.55)';
      const rv = Math.max(1, 0.025 * s);
      for (let i = 1; i < sw; i++) ctx.fillRect(x0 + i * s - rv / 2, y0 + h * 0.55, rv, rv);
    });
  }

  private makeLabel(t: number): Baked {
    const sw = this.level.shelves[t].slots * W3.slot;
    const y = shelfSurfaceY(t) - PLANK_H - LABEL_GAP;
    const w = (sw - 0.12) * this.s;
    const h = LABEL_H * this.s;
    return { canvas: document.createElement('canvas'), x: (-w / 2), y: -y * this.s, w, h };
  }

  /** Decor that sits in the cargo space: a gold zone or a sealed-shelf block. */
  private bakeDecor(t: number): Baked | null {
    const def = this.level.shelves[t];
    const y = shelfSurfaceY(t);
    const s = this.s;
    if (def.locked) {
      const sw = def.slots * W3.slot;
      return this.bake(-sw / 2, y + W3.cargoH, sw, W3.cargoH, (ctx) => {
        const x0 = (-sw / 2) * s;
        const y0 = -(y + W3.cargoH) * s;
        ctx.translate(x0, y0);
        ctx.fillStyle = 'rgba(26,15,8,0.72)';
        ctx.fillRect(0, 0, sw * s, W3.cargoH * s);
        drawSealedPlaque(ctx, sw * s, W3.cargoH * s);
      });
    }
    const z = def.zone;
    if (!z) return null;
    const x0u = z.from - def.slots / 2 + 0.03;
    const wu = z.to - z.from - 0.06;
    return this.bake(x0u, y + W3.cargoH, wu, W3.cargoH + 0.03, (ctx) => {
      const x0 = x0u * s;
      const y0 = -(y + W3.cargoH) * s;
      const w = wu * s;
      const h = W3.cargoH * s;
      const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
      g.addColorStop(0, 'rgba(255,201,60,0.06)');
      g.addColorStop(1, 'rgba(255,201,60,0.26)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, w, h);
      ctx.setLineDash(DASH_ZONE);
      ctx.strokeStyle = 'rgba(255,201,60,0.8)';
      ctx.lineWidth = Math.max(1.5, 0.03 * s);
      ctx.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
      ctx.setLineDash(NO_DASH);
      // Star pictogram per zone slot, so the zone is not told by colour alone.
      ctx.fillStyle = 'rgba(255,201,60,0.3)';
      for (let slot = z.from; slot < z.to; slot++) {
        const cx = slotCentreX(def.slots, slot, 1) * s;
        star(ctx, cx, y0 + h * 0.4, h * 0.2);
      }
      // Rim on the plank surface.
      ctx.fillStyle = 'rgba(255,201,60,0.9)';
      ctx.fillRect(x0, y0 + h - Math.max(2, 0.045 * s), w, Math.max(2, 0.045 * s));
    });
  }

  /** The PRIORITY tag of a gold zone, shown while the zone is empty. */
  private bakeTag(t: number): Baked | null {
    const def = this.level.shelves[t];
    const z = def.zone;
    if (!z || def.locked) return null;
    const s = this.s;
    const w = (z.to - z.from - 0.06) * s;
    const tw = Math.min(w - 0.1 * s, 1.7 * s);
    const th = Math.max(15, 0.36 * s);
    // Its own canvas: the shared art clears its box before drawing.
    const [c, ctx] = makeCanvas(tw * this.dpr, th * this.dpr);
    drawPriorityTag(ctx, c.width, c.height);
    const cx = ((z.from + z.to) / 2 - def.slots / 2) * s;
    const bottom = -shelfSurfaceY(t) * s - 0.07 * s;
    return { canvas: c, x: cx - tw / 2, y: bottom - th, w: tw, h: th };
  }

  // --- state ----------------------------------------------------------------

  /** Redraws a shelf label when its load changes. */
  setLoad(t: number, load: number) {
    const lb = this.labels[t];
    if (!lb || this.loads[t] === load) return;
    this.loads[t] = load;
    const shelf = this.level.shelves[t];
    const hDev = (lb.h / (LABEL_CROP[1] - LABEL_CROP[0])) * this.dpr;
    const pxPerUnit = hDev / 0.3;
    drawShelfLabel(lb.canvas, (lb.w * this.dpr) / pxPerUnit, {
      leverage: tierLeverage(t, TIER_LEVERAGE_STEP),
      tier: t,
      load,
      max: shelf.maxWeight,
    }, pxPerUnit);
  }

  // --- drawing (rack-local CSS px) -------------------------------------------

  /** Red glow behind overloaded planks. `alpha[t]` is 0 when a tier is fine. */
  drawGlows(ctx: CanvasRenderingContext2D, alpha: ArrayLike<number>) {
    const s = this.s;
    ctx.globalCompositeOperation = 'lighter';
    for (let t = 0; t < this.level.shelves.length; t++) {
      const a = alpha[t];
      if (!(a > 0.01)) continue;
      const sw = this.level.shelves[t].slots + 1.2;
      const y = shelfSurfaceY(t);
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(this.glow, (-sw / 2) * s, -(y + 0.45) * s, sw * s, 1.1 * s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Gold zones and sealed shelves; `zoneEmpty[t]` shows a zone's PRIORITY tag. */
  drawDecor(ctx: CanvasRenderingContext2D, zoneEmpty?: ArrayLike<boolean>) {
    for (const d of this.decor) if (d) ctx.drawImage(d.canvas, d.x, d.y, d.w, d.h);
    for (let t = 0; t < this.tags.length; t++) {
      const tag = this.tags[t];
      if (tag && (!zoneEmpty || zoneEmpty[t])) ctx.drawImage(tag.canvas, tag.x, tag.y, tag.w, tag.h);
    }
  }

  drawColumns(ctx: CanvasRenderingContext2D, cols: readonly CrushColumn[], emphasise: boolean) {
    if (!cols.length) return;
    const s = this.s;
    ctx.setLineDash(DASH_COLUMN);
    ctx.lineWidth = Math.max(1.5, 0.028 * s);
    for (const c of cols) {
      const x = c.x * s;
      const y = -c.top * s;
      const w = c.w * s;
      const h = (c.top - c.bottom) * s;
      if (h <= 1) continue;
      ctx.fillStyle = emphasise ? 'rgba(95,178,182,0.3)' : 'rgba(95,178,182,0.11)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = emphasise ? 'rgba(150,230,234,0.9)' : 'rgba(120,200,204,0.45)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + h);
      ctx.moveTo(x + w, y);
      ctx.lineTo(x + w, y + h);
      ctx.stroke();
    }
    ctx.setLineDash(NO_DASH);
  }

  drawFrame(ctx: CanvasRenderingContext2D) {
    const f = this.frame;
    ctx.drawImage(f.canvas, f.x, f.y, f.w, f.h);
  }

  /** One plank and its label; `flex` (world units, <= 0) dips the plank under a landing. */
  drawShelf(ctx: CanvasRenderingContext2D, t: number, flex: number) {
    const p = this.planks[t];
    const dy = -flex * this.s;
    ctx.drawImage(p.canvas, p.x, p.y + dy, p.w, p.h);
    const lb = this.labels[t];
    if (lb && lb.canvas.width > 1) {
      const ch = lb.canvas.height;
      ctx.drawImage(
        lb.canvas,
        0,
        ch * LABEL_CROP[0],
        lb.canvas.width,
        ch * (LABEL_CROP[1] - LABEL_CROP[0]),
        lb.x,
        lb.y + dy * 0.5,
        lb.w,
        lb.h,
      );
    }
  }

  /** Rack-local CSS-px box of a tier: its cargo space, plank and label (for highlights). */
  tierBox(t: number): { x: number; y: number; w: number; h: number } {
    const sw = this.level.shelves[t].slots * W3.slot;
    const top = cargoCentreY(t) + W3.cargoH / 2 + 0.04;
    const bottom = shelfSurfaceY(t) - PLANK_H - LABEL_GAP - LABEL_H - 0.02;
    return { x: (-sw / 2 - 0.06) * this.s, y: -top * this.s, w: (sw + 0.12) * this.s, h: (top - bottom) * this.s };
  }

  dispose() {
    freeCanvas(this.frame.canvas);
    for (const p of this.planks) freeCanvas(p.canvas);
    for (const l of this.labels) freeCanvas(l?.canvas);
    for (const d of this.decor) freeCanvas(d?.canvas);
    for (const d of this.tags) freeCanvas(d?.canvas);
    freeCanvas(this.glow);
    this.planks = [];
    this.labels = [];
    this.decor = [];
    this.tags = [];
  }
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.43;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}
