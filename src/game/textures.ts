/**
 * Every sprite in Cargo Panic is drawn into a canvas texture at boot. Nothing
 * is loaded from disk, nothing is copyrighted, and because the textures are
 * baked once the render loop never re-rasterises anything.
 */

import Phaser from 'phaser';
import { PKG_H, SLOT_W } from './config';
import { PACKAGE_SPECS } from './levels/types';
import type { PackageType } from './levels/types';

/** Horizontal breathing room between neighbouring packages. */
export const PKG_GAP = 8;
/** Height of the little top face that gives packages their 2.5D read. */
const TOP_D = 13;

export function pkgWidth(slots: number): number {
  return slots * SLOT_W - PKG_GAP;
}

export function pkgTextureKey(type: PackageType): string {
  return `pkg_${type}`;
}

interface Palette {
  face: string;
  faceLo: string;
  top: string;
  side: string;
  ink: string;
  accent: string;
}

const PALETTES: Record<PackageType, Palette> = {
  standard: {
    face: '#cf9048',
    faceLo: '#a96f2f',
    top: '#eab273',
    side: '#8d5a24',
    ink: '#4a2c0c',
    accent: '#f6dcb4',
  },
  heavy: {
    face: '#535f73',
    faceLo: '#3a4455',
    top: '#75849c',
    side: '#2a3140',
    ink: '#0f141c',
    accent: '#f0a53c',
  },
  fragile: {
    face: '#3f8a8e',
    faceLo: '#2b6669',
    top: '#5fb2b6',
    side: '#1f4c4f',
    ink: '#0d2c2e',
    accent: '#c6f4f6',
  },
  long: {
    face: '#b95c31',
    faceLo: '#92431f',
    top: '#dc7c4c',
    side: '#6f3316',
    ink: '#3a1808',
    accent: '#f7cf9c',
  },
  priority: {
    face: '#cfa022',
    faceLo: '#a67c10',
    top: '#f2cb44',
    side: '#7d5c05',
    ink: '#3d2c00',
    accent: '#fff4c9',
  },
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function canvas(scene: Phaser.Scene, key: string, w: number, h: number) {
  const existing = scene.textures.get(key);
  if (existing && existing.key === key && scene.textures.exists(key)) {
    scene.textures.remove(key);
  }
  const tex = scene.textures.createCanvas(key, w, h) as Phaser.Textures.CanvasTexture;
  return { tex, ctx: tex.getContext() };
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

function drawPackage(scene: Phaser.Scene, type: PackageType) {
  const spec = PACKAGE_SPECS[type];
  const w = pkgWidth(spec.slots);
  const h = PKG_H;
  const { tex, ctx } = canvas(scene, pkgTextureKey(type), w, h);
  const p = PALETTES[type];
  const fh = h - TOP_D;

  // Top face: a shallow trapezoid, narrower at the back, so the box reads as
  // being seen from slightly above.
  const inset = 7;
  ctx.beginPath();
  ctx.moveTo(0, TOP_D);
  ctx.lineTo(inset, 0);
  ctx.lineTo(w - inset, 0);
  ctx.lineTo(w, TOP_D);
  ctx.closePath();
  const topGrad = ctx.createLinearGradient(0, 0, 0, TOP_D);
  topGrad.addColorStop(0, p.top);
  topGrad.addColorStop(1, p.face);
  ctx.fillStyle = topGrad;
  ctx.fill();

  // Front face.
  roundRect(ctx, 0, TOP_D, w, fh, 7);
  const faceGrad = ctx.createLinearGradient(0, TOP_D, 0, h);
  faceGrad.addColorStop(0, p.face);
  faceGrad.addColorStop(0.68, p.face);
  faceGrad.addColorStop(1, p.faceLo);
  ctx.fillStyle = faceGrad;
  ctx.fill();

  // Warm rim light from the warehouse lamps above.
  ctx.save();
  roundRect(ctx, 0, TOP_D, w, fh, 7);
  ctx.clip();
  const rim = ctx.createLinearGradient(0, TOP_D, w * 0.6, h);
  rim.addColorStop(0, 'rgba(255,236,200,0.18)');
  rim.addColorStop(0.45, 'rgba(255,255,255,0)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, TOP_D, w, fh);

  drawDetail(ctx, type, w, h, p);
  ctx.restore();

  // Outline.
  roundRect(ctx, 0.75, TOP_D + 0.75, w - 1.5, fh - 1.5, 7);
  ctx.strokeStyle = p.side;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  drawWeightBadge(ctx, w, h, spec.weight, p);
  tex.refresh();
}

function drawDetail(
  ctx: CanvasRenderingContext2D,
  type: PackageType,
  w: number,
  h: number,
  p: Palette,
) {
  const cx = w / 2;
  const fy = TOP_D;
  const fh = h - TOP_D;

  switch (type) {
    case 'standard': {
      // Packing tape down the seam plus a stamped label block.
      ctx.fillStyle = 'rgba(246,220,180,0.55)';
      ctx.fillRect(cx - 7, fy, 14, fh);
      ctx.fillStyle = 'rgba(74,44,12,0.20)';
      ctx.fillRect(cx - 7, fy, 2, fh);
      ctx.fillRect(cx + 5, fy, 2, fh);
      ctx.fillStyle = 'rgba(74,44,12,0.30)';
      ctx.fillRect(9, fy + 12, Math.min(20, cx - 20), 4);
      ctx.fillRect(9, fy + 20, Math.min(14, cx - 24), 4);
      break;
    }
    case 'heavy': {
      // Hazard stripes along the bottom, rivets at the corners.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, h - 17, w, 13);
      ctx.clip();
      ctx.fillStyle = p.accent;
      ctx.fillRect(0, h - 17, w, 13);
      ctx.fillStyle = 'rgba(20,24,32,0.85)';
      for (let x = -20; x < w + 20; x += 15) {
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x + 7, h);
        ctx.lineTo(x + 16, h - 17);
        ctx.lineTo(x + 9, h - 17);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      for (const [rx, ry] of [
        [8, fy + 9],
        [w - 8, fy + 9],
        [8, h - 25],
        [w - 8, h - 25],
      ]) {
        ctx.beginPath();
        ctx.arc(rx, ry, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      // Reinforcing band.
      ctx.strokeStyle = 'rgba(12,16,22,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, fy + 18);
      ctx.lineTo(w, fy + 18);
      ctx.stroke();
      break;
    }
    case 'fragile': {
      // Glass panel with a highlight, plus the classic "this way up" marks.
      ctx.fillStyle = 'rgba(198,244,246,0.20)';
      roundRect(ctx, 7, fy + 7, w - 14, fh - 16, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(198,244,246,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(11, fy + fh - 14);
      ctx.lineTo(w * 0.42, fy + 11);
      ctx.stroke();

      // Stemmed-glass pictogram.
      ctx.fillStyle = p.accent;
      const gx = cx;
      const gy = fy + 15;
      ctx.beginPath();
      ctx.moveTo(gx - 6, gy);
      ctx.lineTo(gx + 6, gy);
      ctx.lineTo(gx + 2.2, gy + 10);
      ctx.lineTo(gx - 2.2, gy + 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(gx - 1.4, gy + 10, 2.8, 9);
      ctx.fillRect(gx - 5.5, gy + 19, 11, 2.6);
      break;
    }
    case 'long': {
      // Two lashing straps and a length arrow.
      ctx.fillStyle = 'rgba(247,207,156,0.6)';
      ctx.fillRect(w * 0.22 - 6, fy, 12, fh);
      ctx.fillRect(w * 0.78 - 6, fy, 12, fh);
      ctx.fillStyle = 'rgba(58,24,8,0.35)';
      ctx.fillRect(w * 0.22 - 6, fy + fh * 0.45, 12, 5);
      ctx.fillRect(w * 0.78 - 6, fy + fh * 0.45, 12, 5);

      ctx.strokeStyle = 'rgba(247,207,156,0.75)';
      ctx.lineWidth = 2;
      const ay = fy + fh - 15;
      ctx.beginPath();
      ctx.moveTo(w * 0.32, ay);
      ctx.lineTo(w * 0.68, ay);
      ctx.stroke();
      ctx.fillStyle = 'rgba(247,207,156,0.75)';
      for (const [tx, dir] of [
        [w * 0.32, -1],
        [w * 0.68, 1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(tx + dir * 7, ay);
        ctx.lineTo(tx, ay - 4.5);
        ctx.lineTo(tx, ay + 4.5);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'priority': {
      // Gold star inside a chevron frame.
      ctx.strokeStyle = 'rgba(255,244,201,0.65)';
      ctx.lineWidth = 2;
      roundRect(ctx, 6, fy + 6, w - 12, fh - 14, 4);
      ctx.stroke();

      ctx.fillStyle = p.accent;
      ctx.save();
      ctx.translate(cx, fy + fh * 0.45);
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 13 : 5.6;
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
  void p;
}

function drawWeightBadge(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  weight: number,
  p: Palette,
) {
  const r = 14;
  const cx = w - r - 6;
  const cy = h - r - 6;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,14,20,0.82)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = p.top;
  ctx.stroke();

  ctx.fillStyle = '#eef4ff';
  ctx.font = 'bold 18px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(weight), cx, cy + 1);
}

// ---------------------------------------------------------------------------
// Effects and UI bits
// ---------------------------------------------------------------------------

function drawDot(scene: Phaser.Scene) {
  const size = 32;
  const { tex, ctx } = canvas(scene, 'fx_dot', size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}

function drawChip(scene: Phaser.Scene) {
  const { tex, ctx } = canvas(scene, 'fx_chip', 12, 12);
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, 1, 1, 10, 10, 2.5);
  ctx.fill();
  tex.refresh();
}

function drawShadow(scene: Phaser.Scene) {
  const w = 160;
  const h = 48;
  const { tex, ctx } = canvas(scene, 'fx_shadow', w, h);
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(1, h / w);
  ctx.translate(-w / 2, -h / 2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
  ctx.restore();
  tex.refresh();
}

function drawStar(scene: Phaser.Scene, key: string, fill: string, stroke: string, size = 72) {
  const { tex, ctx } = canvas(scene, key, size, size);
  const cx = size / 2;
  const cy = size / 2 + 1;
  const outer = size / 2 - 4;
  const inner = outer * 0.44;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke;
  ctx.stroke();
  tex.refresh();
}

function drawBeltTile(scene: Phaser.Scene) {
  const w = 64;
  const h = 46;
  const { tex, ctx } = canvas(scene, 'belt_tile', w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2b3444');
  g.addColorStop(0.5, '#222a37');
  g.addColorStop(1, '#171e28');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, 5, h);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(5, 0, 3, h);

  ctx.strokeStyle = 'rgba(240,165,60,0.30)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(22, 11);
  ctx.lineTo(40, h / 2);
  ctx.lineTo(22, h - 11);
  ctx.stroke();
  tex.refresh();
}

function drawLampGlow(scene: Phaser.Scene) {
  const w = 420;
  const h = 300;
  const { tex, ctx } = canvas(scene, 'fx_lamp', w, h);
  const g = ctx.createRadialGradient(w / 2, 0, 0, w / 2, 0, h);
  g.addColorStop(0, 'rgba(255,214,150,0.30)');
  g.addColorStop(0.35, 'rgba(255,196,120,0.12)');
  g.addColorStop(1, 'rgba(255,180,90,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 34, 0);
  ctx.lineTo(w / 2 + 34, 0);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  tex.refresh();
}

function drawBackdropGradient(scene: Phaser.Scene) {
  const { tex, ctx } = canvas(scene, 'bg_grad', 8, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#1e2b3b');
  g.addColorStop(0.34, '#141d29');
  g.addColorStop(0.72, '#0d141d');
  g.addColorStop(1, '#070a0e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  tex.refresh();
}

function drawVignette(scene: Phaser.Scene) {
  const size = 256;
  const { tex, ctx } = canvas(scene, 'fx_vignette', size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,60,50,0)');
  g.addColorStop(0.62, 'rgba(255,50,40,0.20)');
  g.addColorStop(1, 'rgba(220,25,20,0.72)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}

function drawCracks(scene: Phaser.Scene) {
  const w = pkgWidth(1);
  const h = PKG_H;
  const { tex, ctx } = canvas(scene, 'fx_cracks', w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const seeds: [number, number][] = [
    [0.5, 0.28],
    [0.5, 0.28],
    [0.5, 0.28],
    [0.34, 0.62],
    [0.7, 0.55],
  ];
  const angles = [-2.5, -0.6, 1.4, 2.6, 0.4];
  seeds.forEach(([sx, sy], i) => {
    let x = sx * w;
    let y = sy * h;
    let a = angles[i];
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      a += (i % 2 === 0 ? 1 : -1) * 0.42;
      x += Math.cos(a) * 9;
      y += Math.sin(a) * 9;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
  tex.refresh();
}

/** Called once from BootScene. */
export function generateTextures(scene: Phaser.Scene) {
  (Object.keys(PACKAGE_SPECS) as PackageType[]).forEach((t) => drawPackage(scene, t));
  drawDot(scene);
  drawChip(scene);
  drawShadow(scene);
  drawBeltTile(scene);
  drawLampGlow(scene);
  drawCracks(scene);
  drawVignette(scene);
  drawBackdropGradient(scene);
  drawStar(scene, 'star_on', '#ffc93c', '#8a5f00');
  drawStar(scene, 'star_off', '#2b3444', '#3d4a5c');
  drawStar(scene, 'star_small_on', '#ffc93c', '#8a5f00', 40);
  drawStar(scene, 'star_small_off', '#232c39', '#333f4f', 40);
}
