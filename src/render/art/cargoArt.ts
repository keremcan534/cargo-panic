/**
 * Canvas 2D artwork shared by both renderers: cargo faces, the sealed-shelf
 * plaque, the gold-zone tag and the shelf instrument label. The 3D view bakes
 * these into textures; the 2D view draws them straight onto its canvas. One
 * source of art means a package looks like the same package in either view.
 *
 * No three.js here.
 */

import { PACKAGE_SPECS } from '../../game/levels/types';
import type { PackageType } from '../../game/levels/types';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

export interface Palette {
  base: string;
  dark: string;
  accent: string;
  ink: string;
}

export const PALETTES: Record<PackageType, Palette> = {
  standard: { base: '#c98a45', dark: '#8d5a24', accent: '#f6dcb4', ink: '#4a2c0c' },
  heavy: { base: '#4f5b6e', dark: '#2a3140', accent: '#f0a53c', ink: '#0f141c' },
  fragile: { base: '#3f8a8e', dark: '#1f4c4f', accent: '#c6f4f6', ink: '#0d2c2e' },
  long: { base: '#b8552e', dark: '#6f3316', accent: '#f7cf9c', ink: '#3a1808' },
  priority: { base: '#cfa022', dark: '#7d5c05', accent: '#fff4c9', ink: '#3d2c00' },
};

/** Faint corrugation used on every cardboard face. */
function flutes(ctx: CanvasRenderingContext2D, w: number, h: number, strength = 0.07) {
  ctx.globalAlpha = strength;
  for (let y = 0; y < h; y += 6) {
    ctx.fillStyle = y % 12 ? '#000' : '#fff';
    ctx.fillRect(0, y, w, 3);
  }
  ctx.globalAlpha = 1;
}

/** Weight badge in the lower-right corner of a front face. */
function badge(ctx: CanvasRenderingContext2D, w: number, h: number, weight: number, ring: string) {
  const r = h * 0.14;
  const cx = w - r - h * 0.07;
  const cy = h - r - h * 0.07;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,14,20,0.86)';
  ctx.fill();
  ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.fillStyle = '#eef4ff';
  ctx.font = `bold ${Math.round(r * 1.3)}px "Trebuchet MS", "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(weight), cx, cy + r * 0.06);
}

/**
 * Front face of a package: type-specific art plus the weight badge, drawn
 * into a w x h box at the context origin. The 3D cargo textures and the 2D
 * sprites are both baked from this, so a package reads the same in either view.
 */
export function drawCargoFront(
  ctx: CanvasRenderingContext2D,
  type: PackageType,
  w: number,
  h: number,
  cracked = false,
): void {
  const p = PALETTES[type];
  const spec = PACKAGE_SPECS[type];

  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, w, h);

  switch (type) {
    case 'standard': {
      flutes(ctx, w, h);
      ctx.fillStyle = 'rgba(246,220,180,0.62)';
      ctx.fillRect(w / 2 - h * 0.09, 0, h * 0.18, h);
      ctx.fillStyle = 'rgba(74,44,12,0.25)';
      ctx.fillRect(w / 2 - h * 0.09, 0, 3, h);
      ctx.fillRect(w / 2 + h * 0.09 - 3, 0, 3, h);
      ctx.fillStyle = 'rgba(74,44,12,0.32)';
      ctx.fillRect(h * 0.12, h * 0.16, h * 0.3, h * 0.055);
      ctx.fillRect(h * 0.12, h * 0.27, h * 0.2, h * 0.055);
      break;
    }
    case 'heavy': {
      ctx.globalAlpha = 0.12;
      for (let i = 0; i < 700; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
        ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      ctx.globalAlpha = 1;
      const band = h * 0.17;
      ctx.fillStyle = p.accent;
      ctx.fillRect(0, h - band, w, band);
      ctx.fillStyle = '#151a22';
      for (let x = -band; x < w + band; x += band * 0.9) {
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x + band * 0.4, h);
        ctx.lineTo(x + band * 0.9, h - band);
        ctx.lineTo(x + band * 0.5, h - band);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, h * 0.16, w, h * 0.035);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      for (const [x, y] of [[h * 0.09, h * 0.09], [w - h * 0.09, h * 0.09], [h * 0.09, h * 0.7], [w - h * 0.09, h * 0.7]]) {
        ctx.beginPath();
        ctx.arc(x, y, h * 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'fragile': {
      ctx.fillStyle = 'rgba(198,244,246,0.16)';
      roundRect(ctx, h * 0.09, h * 0.09, w - h * 0.18, h - h * 0.2, h * 0.05);
      ctx.fill();
      ctx.strokeStyle = 'rgba(198,244,246,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(h * 0.14, h * 0.82);
      ctx.lineTo(w * 0.42, h * 0.14);
      ctx.stroke();
      // Glass pictogram.
      const gx = w / 2;
      const gy = h * 0.2;
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.moveTo(gx - h * 0.08, gy);
      ctx.lineTo(gx + h * 0.08, gy);
      ctx.lineTo(gx + h * 0.03, gy + h * 0.14);
      ctx.lineTo(gx - h * 0.03, gy + h * 0.14);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(gx - h * 0.018, gy + h * 0.14, h * 0.036, h * 0.12);
      ctx.fillRect(gx - h * 0.07, gy + h * 0.26, h * 0.14, h * 0.035);
      if (cracked) {
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        const seeds: [number, number, number][] = [[0.5, 0.3, -2.5], [0.5, 0.3, -0.6], [0.5, 0.3, 1.4], [0.35, 0.62, 2.6], [0.7, 0.55, 0.4]];
        seeds.forEach(([sx, sy, a0], i) => {
          let x = sx * w;
          let y = sy * h;
          let a = a0;
          ctx.beginPath();
          ctx.moveTo(x, y);
          for (let s = 0; s < 4; s++) {
            a += (i % 2 ? -1 : 1) * 0.42;
            x += Math.cos(a) * h * 0.12;
            y += Math.sin(a) * h * 0.12;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        });
      }
      break;
    }
    case 'long': {
      flutes(ctx, w, h);
      for (const fx of [0.22, 0.78]) {
        ctx.fillStyle = 'rgba(247,207,156,0.6)';
        ctx.fillRect(w * fx - h * 0.08, 0, h * 0.16, h);
        ctx.fillStyle = 'rgba(58,24,8,0.35)';
        ctx.fillRect(w * fx - h * 0.08, h * 0.45, h * 0.16, h * 0.07);
      }
      ctx.strokeStyle = 'rgba(247,207,156,0.75)';
      ctx.lineWidth = 3;
      const ay = h * 0.78;
      ctx.beginPath();
      ctx.moveTo(w * 0.32, ay);
      ctx.lineTo(w * 0.68, ay);
      ctx.stroke();
      ctx.fillStyle = 'rgba(247,207,156,0.75)';
      for (const [tx, dir] of [[w * 0.32, -1], [w * 0.68, 1]] as const) {
        ctx.beginPath();
        ctx.moveTo(tx + dir * h * 0.09, ay);
        ctx.lineTo(tx, ay - h * 0.06);
        ctx.lineTo(tx, ay + h * 0.06);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'priority': {
      ctx.strokeStyle = 'rgba(255,244,201,0.65)';
      ctx.lineWidth = 3;
      roundRect(ctx, h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.18, h * 0.05);
      ctx.stroke();
      ctx.fillStyle = p.accent;
      ctx.save();
      ctx.translate(w / 2, h * 0.44);
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? h * 0.18 : h * 0.078;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
  }

  // Edge occlusion and a grounded base, as on the 2D sprites.
  const edge = ctx.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, 'rgba(0,0,0,0.26)');
  edge.addColorStop(0.1, 'rgba(0,0,0,0)');
  edge.addColorStop(0.9, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
  const base = ctx.createLinearGradient(0, h * 0.8, 0, h);
  base.addColorStop(0, 'rgba(0,0,0,0)');
  base.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = base;
  ctx.fillRect(0, h * 0.8, w, h * 0.2);

  badge(ctx, w, h, spec.weight, p.accent);
}

/** Plain side/top face: colour, flutes, edge shade, in a size x size box. */
export function drawCargoSide(ctx: CanvasRenderingContext2D, type: PackageType, size: number): void {
  const TEX_PX = size;
  const p = PALETTES[type];
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, TEX_PX, TEX_PX);
  if (type === 'standard' || type === 'long') flutes(ctx, TEX_PX, TEX_PX);
  if (type === 'heavy') {
    ctx.globalAlpha = 0.1;
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
      ctx.fillRect(Math.random() * TEX_PX, Math.random() * TEX_PX, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
  const g = ctx.createLinearGradient(0, 0, 0, TEX_PX);
  g.addColorStop(0, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TEX_PX, TEX_PX);
}

/** Hazard-striped plaque for a sealed shelf, in a w x h box. */
export function drawSealedPlaque(ctx: CanvasRenderingContext2D, w: number, h: number, text = 'OUT OF SERVICE'): void {
  ctx.fillStyle = 'rgba(26,15,8,0.92)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#59341f';
  ctx.lineWidth = h * 0.12;
  for (const dy of [0.16, 0.78]) {
    ctx.beginPath();
    ctx.moveTo(h * 0.08, h * dy + h * 0.06);
    ctx.lineTo(w - h * 0.08, h * dy - h * 0.06);
    ctx.stroke();
  }
  ctx.fillStyle = '#e8b083';
  ctx.font = `bold ${Math.round(h * 0.26)}px "Trebuchet MS", "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
}

/** Gold-zone tag, in a w x h box (dark pill, gold text). */
export function drawPriorityTag(ctx: CanvasRenderingContext2D, w: number, h: number, text = 'PRIORITY'): void {
  const c = { width: w, height: h };
  ctx.clearRect(0, 0, c.width, c.height);
  // Dark pill so the gold text reads against the gold zone slab.
  const pad = c.height * 0.08;
  ctx.fillStyle = 'rgba(17,24,35,0.92)';
  roundRect(ctx, c.width * 0.12, pad, c.width * 0.76, c.height - pad * 2, (c.height - pad * 2) / 2);
  ctx.fill();
  ctx.fillStyle = '#ffc93c';
  ctx.font = `bold ${Math.round(c.height * 0.56)}px "Trebuchet MS", "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 1);
}

/**
 * The instrument row under a shelf: leverage pill, load bar, load text.
 * Redrawn on demand; returns the texture so the caller can flag needsUpdate.
 */
export interface ShelfLabelState {
  leverage: number;
  tier: number;
  load: number;
  max: number;
}

export function drawShelfLabel(
  canvas: HTMLCanvasElement | null,
  widthUnits: number,
  s: ShelfLabelState,
  pxPerUnit = 256,
): HTMLCanvasElement {
  const w = Math.round(pxPerUnit * widthUnits);
  const h = Math.round(pxPerUnit * 0.3);
  const c = canvas ?? document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, w, h);

  const pad = h * 0.18;
  const pillW = h * 1.9;
  // Leverage pill.
  ctx.fillStyle = 'rgba(17,24,35,0.96)';
  roundRect(ctx, pad, h * 0.22, pillW, h * 0.56, h * 0.28);
  ctx.fill();
  ctx.strokeStyle = s.tier === 0 ? 'rgba(46,58,75,0.9)' : 'rgba(77,163,255,0.85)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = s.tier === 0 ? '#8fa2ba' : '#4da3ff';
  ctx.font = `bold ${Math.round(h * 0.38)}px "Trebuchet MS", "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`x${s.leverage.toFixed(2)}`, pad + pillW / 2, h * 0.51);

  // Load text.
  const ratio = s.max > 0 ? s.load / s.max : 0;
  const over = ratio > 1;
  const color = over ? '#ff5f57' : ratio > 0.75 ? '#f5c451' : '#8fa2ba';
  ctx.textAlign = 'right';
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.round(h * 0.4)}px "Trebuchet MS", "Segoe UI", sans-serif`;
  const label = `${s.load}/${s.max}`;
  ctx.fillText(label, w - pad, h * 0.51);
  const textW = ctx.measureText(label).width;

  // Load bar between them.
  const bx0 = pad + pillW + h * 0.3;
  const bx1 = w - pad - textW - h * 0.3;
  const bw = Math.max(0, bx1 - bx0);
  ctx.fillStyle = 'rgba(10,14,20,0.92)';
  roundRect(ctx, bx0, h * 0.32, bw, h * 0.36, h * 0.18);
  ctx.fill();
  const fill = Math.max(0, Math.min(1, ratio)) * (bw - 6);
  if (fill > 0) {
    ctx.fillStyle = over ? '#ff5f57' : ratio > 0.75 ? '#f5c451' : '#3fd68a';
    roundRect(ctx, bx0 + 3, h * 0.38, fill, h * 0.24, h * 0.12);
    ctx.fill();
  }
  if (over) {
    ctx.strokeStyle = '#ff5f57';
    ctx.lineWidth = 3;
    roundRect(ctx, bx0, h * 0.32, bw, h * 0.36, h * 0.18);
    ctx.stroke();
  }
  return c;
}

