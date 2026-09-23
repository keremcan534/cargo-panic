/**
 * The night warehouse around the play area, and the two menu backdrops.
 *
 * `bakeWarehouse` paints the static surroundings once per size into an
 * offscreen canvas: a dark wall with distant racking, three hanging lamps
 * throwing warm cones, the floor with a light pool where the rack stands, and
 * a vignette. The play area is the brightest thing on screen.
 *
 * `MenuBackdrop2D` is the title screen's hero rack (HERO_LEVEL / HERO_CARGO
 * from render/hero.ts, the same data the 3D title screen uses), swaying
 * gently; `LevelsBackdrop2D` is the bare warehouse behind the level grid.
 * Both re-frame themselves on resize.
 */

import { W3 } from '../../game/config';
import type { PackageType } from '../../game/levels/types';
import { HERO_CARGO, HERO_LEVEL, heroSway } from '../hero';
import type { Backdrop } from '../Stage';
import { rackHalfWidth, rackTopY } from '../layout';
import { cargoCentreY, layout2d, slotCentreX } from './layout2d';
import { RackArt2D } from './rack2d';
import { bakeCargoSprite, freeCanvas, makeCanvas } from './sprites2d';
import type { CargoSprite } from './sprites2d';
import type { Host2D, Layer2D } from './types2d';

// ---------------------------------------------------------------------------
// Warehouse
// ---------------------------------------------------------------------------

export interface WarehouseFrame {
  width: number;
  height: number;
  dpr: number;
  /** CSS px per world unit. */
  scale: number;
  originX: number;
  floorY: number;
  /** Half-width (world units) of the rack the lights are aimed at. */
  halfWidth: number;
  /** World y of the rack's top; the back-light is centred on the rack. */
  rackTop: number;
  /** Screen y (CSS px) where the lamp housings hang. */
  lampY: number;
  /** Warm pool and contact shadow on the floor under the rack. */
  pool: boolean;
}

/** Deterministic pseudo-random for the scenery (the same wall every time). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function bakeWarehouse(f: WarehouseFrame, into?: HTMLCanvasElement): HTMLCanvasElement {
  let c = into;
  let ctx: CanvasRenderingContext2D;
  if (c) {
    c.width = Math.max(1, Math.ceil(f.width * f.dpr));
    c.height = Math.max(1, Math.ceil(f.height * f.dpr));
    ctx = c.getContext('2d') as CanvasRenderingContext2D;
  } else {
    [c, ctx] = makeCanvas(f.width * f.dpr, f.height * f.dpr);
  }
  ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  const W = f.width;
  const H = f.height;
  const s = f.scale;
  const ox = f.originX;
  const fy = f.floorY;
  const hw = f.halfWidth;
  const rand = lcg(7);

  // Wall.
  const wall = ctx.createLinearGradient(0, 0, 0, fy);
  wall.addColorStop(0, '#04070b');
  wall.addColorStop(0.55, '#0b111a');
  wall.addColorStop(1, '#16202d');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, fy);
  // Corrugated panels.
  const panel = Math.max(10, 0.5 * s);
  for (let x = (ox % panel) - panel; x < W; x += panel) {
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(x, 0, 2, fy);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x + 2, 0, 1, fy);
  }
  // A painted band low on the wall.
  ctx.fillStyle = 'rgba(40,58,82,0.35)';
  ctx.fillRect(0, fy - 1.25 * s, W, 0.5 * s);
  ctx.fillStyle = 'rgba(240,165,60,0.12)';
  ctx.fillRect(0, fy - 0.76 * s, W, Math.max(1, 0.04 * s));

  // Distant racking: smaller, dimmer, standing on a slightly higher horizon.
  const k = 0.56;
  const baseY = fy - 0.35 * s;
  const pitch = 3.9;
  const first = Math.floor(-(ox / (s * k)) / pitch) - 1;
  const last = Math.ceil(((W - ox) / (s * k)) / pitch) + 1;
  for (let i = first; i <= last; i++) {
    const wu = 2.6 + rand() * 1.0;
    const hu = 5.2 + rand() * 3.2;
    const cx = ox + (i * pitch + 1.2) * s * k;
    const w = wu * s * k;
    const h = hu * s * k;
    const x0 = cx - w / 2;
    ctx.fillStyle = '#0c131d';
    ctx.fillRect(x0, baseY - h, w, h);
    const tiers = 4;
    for (let t = 0; t < tiers; t++) {
      const py = baseY - (0.35 + t * (hu / tiers)) * s * k;
      // Silhouettes of stock.
      let x = x0 + 0.15 * s * k;
      while (x < x0 + w - 0.4 * s * k) {
        const bw = (0.5 + rand() * 0.7) * s * k;
        const bh = (0.45 + rand() * 0.5) * s * k;
        if (rand() > 0.25 && x + bw < x0 + w - 0.1 * s * k) {
          ctx.fillStyle = rand() > 0.7 ? '#1a1813' : '#121b27';
          ctx.fillRect(x, py - bh, bw, bh);
        }
        x += bw + 0.08 * s * k;
      }
      ctx.fillStyle = '#1b2636';
      ctx.fillRect(x0, py, w, Math.max(1.5, 0.1 * s * k));
    }
    ctx.fillStyle = '#18222f';
    ctx.fillRect(x0 - 0.08 * s * k, baseY - h, 0.14 * s * k, h);
    ctx.fillRect(x0 + w - 0.06 * s * k, baseY - h, 0.14 * s * k, h);
  }
  // Haze in front of the far racks.
  const haze = ctx.createLinearGradient(0, baseY - 6 * s * k, 0, fy);
  haze.addColorStop(0, 'rgba(11,16,23,0.55)');
  haze.addColorStop(1, 'rgba(22,32,45,0.25)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, W, fy);

  ctx.globalCompositeOperation = 'lighter';
  // Back-light on the wall behind the rack: the play area is the bright spot.
  const midY = fy - f.rackTop * s * 0.5;
  const rad = Math.max(hw * 1.5, f.rackTop * 0.9) * s;
  const back = ctx.createRadialGradient(ox, midY, 0, ox, midY, rad);
  back.addColorStop(0, 'rgba(255,205,140,0.16)');
  back.addColorStop(0.6, 'rgba(255,190,120,0.06)');
  back.addColorStop(1, 'rgba(255,190,120,0)');
  ctx.fillStyle = back;
  ctx.fillRect(0, 0, W, fy + 2 * s);

  // Lamp cones.
  const lamps = [-hw * 0.9, 0, hw * 0.9];
  const coneBottom = fy + 0.5 * s;
  for (const lx of lamps) {
    const sx = ox + lx * s;
    const g = ctx.createLinearGradient(0, f.lampY, 0, coneBottom);
    g.addColorStop(0, 'rgba(255,214,150,0.16)');
    g.addColorStop(0.7, 'rgba(255,214,150,0.05)');
    g.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sx - 0.24 * s, f.lampY);
    ctx.lineTo(sx + 0.24 * s, f.lampY);
    ctx.lineTo(sx + 2.4 * s, coneBottom);
    ctx.lineTo(sx - 2.4 * s, coneBottom);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Floor.
  const floor = ctx.createLinearGradient(0, fy, 0, H);
  floor.addColorStop(0, '#1d2633');
  floor.addColorStop(Math.min(1, (1.6 * s) / Math.max(1, H - fy)), '#111821');
  floor.addColorStop(1, '#06080c');
  ctx.fillStyle = floor;
  ctx.fillRect(0, fy, W, H - fy);
  ctx.fillStyle = 'rgba(160,180,210,0.22)';
  ctx.fillRect(0, fy, W, 1);
  // Painted safety line along the aisle.
  ctx.fillStyle = 'rgba(240,165,60,0.28)';
  const dash = Math.max(8, 0.45 * s);
  for (let x = (ox % (dash * 2)) - dash * 2; x < W; x += dash * 2) {
    ctx.fillRect(x, fy + 0.3 * s, dash, Math.max(1.5, 0.05 * s));
  }

  if (f.pool) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.translate(ox, fy + 0.2 * s);
    ctx.scale(1, 0.34);
    const r = hw * 1.8 * s;
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    pool.addColorStop(0, 'rgba(255,217,160,0.24)');
    pool.addColorStop(1, 'rgba(255,217,160,0)');
    ctx.fillStyle = pool;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    // Contact shadow under the rack.
    ctx.save();
    ctx.translate(ox, fy + 0.03 * s);
    ctx.scale(1, 0.12);
    const sr = hw * 1.1 * s;
    const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, sr);
    sh.addColorStop(0, 'rgba(0,0,0,0.55)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(-sr, -sr, sr * 2, sr * 2);
    ctx.restore();
  }

  // Lamp housings and bulbs over the cones.
  for (const lx of lamps) {
    const sx = ox + lx * s;
    ctx.strokeStyle = 'rgba(40,52,68,0.9)';
    ctx.lineWidth = Math.max(1, 0.03 * s);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, f.lampY - 0.1 * s);
    ctx.stroke();
    ctx.fillStyle = '#1c2533';
    ctx.beginPath();
    ctx.moveTo(sx - 0.16 * s, f.lampY - 0.12 * s);
    ctx.lineTo(sx + 0.16 * s, f.lampY - 0.12 * s);
    ctx.lineTo(sx + 0.36 * s, f.lampY + 0.06 * s);
    ctx.lineTo(sx - 0.36 * s, f.lampY + 0.06 * s);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    const bulb = ctx.createRadialGradient(sx, f.lampY + 0.08 * s, 0, sx, f.lampY + 0.08 * s, 0.9 * s);
    bulb.addColorStop(0, 'rgba(255,236,196,0.9)');
    bulb.addColorStop(0.15, 'rgba(255,214,150,0.45)');
    bulb.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = bulb;
    ctx.fillRect(sx - 0.9 * s, f.lampY - 0.82 * s, 1.8 * s, 1.8 * s);
    ctx.globalCompositeOperation = 'source-over';
  }

  // Vignette.
  const vg = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.3, W / 2, H * 0.55, Math.max(W, H) * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  return c;
}

// ---------------------------------------------------------------------------
// Backdrops
// ---------------------------------------------------------------------------

export class MenuBackdrop2D implements Backdrop, Layer2D {
  private bg: HTMLCanvasElement | null = null;
  private rack: RackArt2D | null = null;
  private sprites = new Map<PackageType, CargoSprite>();
  private originX = 0;
  private floorY = 0;
  private t = 0;
  private disposed = false;

  constructor(private host: Host2D) {
    host.attach(this);
  }

  resize(width: number, height: number, dpr: number) {
    this.free();
    const tiers = HERO_LEVEL.shelves.length;
    const L = layout2d(width, height, tiers, 6);
    const top = rackTopY(tiers);
    // The hero rack sits between the wordmark and the buttons, like the 3D title.
    this.originX = L.originX;
    this.floorY = height * 0.43 + (top * L.scale) / 2;
    this.rack = new RackArt2D(HERO_LEVEL, L.scale, dpr);
    this.bg = bakeWarehouse({
      width,
      height,
      dpr,
      scale: L.scale,
      originX: L.originX,
      floorY: this.floorY,
      halfWidth: rackHalfWidth(6),
      rackTop: top,
      lampY: height * 0.035,
      pool: true,
    });
    for (const [type] of HERO_CARGO) {
      if (!this.sprites.has(type)) this.sprites.set(type, bakeCargoSprite(this.host.art, type, false, L.scale, dpr));
    }
  }

  draw(ctx: CanvasRenderingContext2D, dtMs: number) {
    const rack = this.rack;
    if (!this.bg || !rack) return;
    this.t += dtMs;
    ctx.drawImage(this.bg, 0, 0, this.host.width, this.host.height);
    // Same sway as the 3D title (hero.ts); none under reduced motion.
    const tilt = this.host.reducedMotion ? 0 : heroSway(this.t);
    const s = rack.s;
    ctx.save();
    ctx.translate(this.originX, this.floorY);
    ctx.rotate(-tilt);
    rack.drawDecor(ctx);
    rack.drawFrame(ctx);
    for (let t = 0; t < HERO_LEVEL.shelves.length; t++) rack.drawShelf(ctx, t, 0);
    for (const [type, tier, slot] of HERO_CARGO) {
      const spr = this.sprites.get(type);
      if (!spr) continue;
      const slots = type === 'long' ? 3 : 1;
      const cx = slotCentreX(HERO_LEVEL.shelves[tier].slots, slot, slots) * s;
      const cy = -cargoCentreY(tier) * s;
      ctx.drawImage(spr.canvas, cx - spr.w / 2 - spr.pad, cy - spr.h / 2 - spr.pad, spr.w + spr.pad * 2, spr.h + spr.pad * 2);
    }
    ctx.restore();
  }

  private free() {
    freeCanvas(this.bg);
    this.bg = null;
    this.rack?.dispose();
    this.rack = null;
    for (const spr of this.sprites.values()) freeCanvas(spr.canvas);
    this.sprites.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.host.detach(this);
    this.free();
  }
}

export class LevelsBackdrop2D implements Backdrop, Layer2D {
  private bg: HTMLCanvasElement | null = null;
  private disposed = false;

  constructor(private host: Host2D) {
    host.attach(this);
  }

  resize(width: number, height: number, dpr: number) {
    const L = layout2d(width, height, 3, 7);
    this.bg = bakeWarehouse(
      {
        width,
        height,
        dpr,
        scale: L.scale,
        originX: L.originX,
        floorY: L.floorY - W3.cargoH,
        halfWidth: 3.8,
        rackTop: rackTopY(3),
        lampY: height * 0.035,
        pool: true,
      },
      this.bg ?? undefined,
    );
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.bg) ctx.drawImage(this.bg, 0, 0, this.host.width, this.host.height);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.host.detach(this);
    freeCanvas(this.bg);
    this.bg = null;
  }
}
