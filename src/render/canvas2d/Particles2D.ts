/**
 * The 2D particle pool: dust puffs, sparks, glass shards, debris chips,
 * confetti and glints. One fixed-size set of typed arrays; emitting reuses the
 * oldest slot, so a burst never allocates. Positions are world units (y up),
 * drawn through whatever layout the current view passes in.
 *
 * Kinds and tuning mirror the 3D pool (render/Particles.ts) so a landing or a
 * shatter reads the same in both views.
 */

import { roundRect } from '../art/cargoArt';

const MAX = 480;

export type Burst2D = 'dust' | 'spark' | 'glass' | 'debris' | 'confetti' | 'glint';

const KIND: Record<Burst2D, number> = { dust: 0, spark: 1, glass: 2, debris: 3, confetti: 4, glint: 5 };

/** Every colour a particle can take; kinds index into this. */
const COLORS = [
  '#d8c6a8', // 0 dust
  '#f0a53c', // 1 spark
  '#c6f4f6', // 2 glass
  '#8fdfe3', // 3 glass
  '#ffffff', // 4 glass / confetti
  '#8d5a24', // 5 debris
  '#535f73', // 6 debris
  '#3d4a5c', // 7 debris
  '#cf9048', // 8 debris
  '#4da3ff', // 9 confetti
  '#ffc93c', // 10 confetti
  '#3fd68a', // 11 confetti
  '#ff8f6b', // 12 confetti
] as const;

const GLASS = [2, 3, 4];
const DEBRIS = [5, 6, 7, 8];
const CONFETTI = [9, 10, 11, 12, 4];

/** Soft kinds are drawn with a pre-baked radial sprite per colour. */
const SOFT_SPRITES: Record<number, string> = { 0: '#d8c6a8', 1: '#f0a53c', 2: '#c6f4f6' };

export interface ParticleView {
  originX: number;
  floorY: number;
  scale: number;
}

function pick(list: number[]): number {
  return list[Math.floor(Math.random() * list.length)];
}

export class Particles2D {
  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private rot = new Float32Array(MAX);
  private spin = new Float32Array(MAX);
  private kind = new Uint8Array(MAX);
  private color = new Uint8Array(MAX);
  private head = 0;
  private alive = 0;
  private sprites = new Map<number, HTMLCanvasElement>();

  /** Live particle count (tests and budgets). */
  get count(): number {
    let n = 0;
    if (this.alive === 0) return 0;
    for (let i = 0; i < MAX; i++) if (this.life[i] > 0) n++;
    return n;
  }

  emit(kind: Burst2D, x: number, y: number, count: number) {
    for (let n = 0; n < count; n++) this.spawn(kind, x, y);
  }

  private spawn(kind: Burst2D, x: number, y: number) {
    const i = this.head;
    this.head = (this.head + 1) % MAX;
    this.alive = Math.min(MAX, this.alive + 1);

    let speed = 1.5;
    let up = 1.2;
    let life = 0.6;
    let size = 0.3;
    let grav = 3;
    let color = 4;
    let spin = 0;
    switch (kind) {
      case 'dust':
        speed = 0.8;
        up = 0.7;
        life = 0.55;
        size = 0.55;
        grav = 0.6;
        color = 0;
        break;
      case 'spark':
        speed = 2.4;
        up = 2.2;
        life = 0.45;
        size = 0.16;
        grav = 7;
        color = 1;
        break;
      case 'glint':
        speed = 0.5;
        up = 0.6;
        life = 0.5;
        size = 0.36;
        grav = 0;
        color = 2;
        break;
      case 'glass':
        speed = 3.2;
        up = 2.6;
        life = 0.75;
        size = 0.14;
        grav = 8;
        color = pick(GLASS);
        spin = 14;
        break;
      case 'debris':
        speed = 3.4;
        up = 3;
        life = 0.9;
        size = 0.22;
        grav = 9;
        color = pick(DEBRIS);
        spin = 10;
        break;
      case 'confetti':
        speed = 4;
        up = 5;
        life = 1.9;
        size = 0.2;
        grav = 5;
        color = pick(CONFETTI);
        spin = 9;
        break;
    }
    this.kind[i] = KIND[kind];
    this.color[i] = color;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = (Math.random() * 2 - 1) * speed;
    this.vy[i] = Math.random() * up;
    const l = life * (0.7 + Math.random() * 0.6);
    this.life[i] = l;
    this.maxLife[i] = l;
    this.size[i] = size * (0.7 + Math.random() * 0.6);
    this.grav[i] = grav;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() * 2 - 1) * spin;
  }

  update(dtMs: number) {
    if (this.alive === 0) return;
    const dt = dtMs / 1000;
    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      any = true;
      this.vy[i] -= this.grav[i] * dt;
      // Confetti drifts: air drag on the way down.
      if (this.kind[i] === 4) {
        this.vx[i] *= 1 - Math.min(1, dt * 1.6);
        if (this.vy[i] < -1.6) this.vy[i] = -1.6;
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.spin[i] * dt;
    }
    if (!any) this.alive = 0;
  }

  /**
   * Draws every live particle through a view's projection. `offX/offY` is the
   * CSS-pixel offset already applied to the play layer (screen shake); the
   * context's base transform must be `scale(dpr)` plus that offset.
   */
  draw(ctx: CanvasRenderingContext2D, v: ParticleView, dpr: number, offX: number, offY: number) {
    if (this.alive === 0) return;
    const s = v.scale;
    // Soft sprites first (normal blend), then additive sparks and glints, then chips.
    for (let pass = 0; pass < 3; pass++) {
      if (pass === 1) ctx.globalCompositeOperation = 'lighter';
      if (pass === 2) ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < MAX; i++) {
        const life = this.life[i];
        if (life <= 0) continue;
        const k = this.kind[i];
        const soft = k === 0 || k === 1 || k === 5;
        if (pass === 0 && k !== 0) continue;
        if (pass === 1 && !(k === 1 || k === 5)) continue;
        if (pass === 2 && soft) continue;
        const t = life / this.maxLife[i];
        const px = v.originX + this.x[i] * s;
        const py = v.floorY - this.y[i] * s;
        const size = this.size[i] * s;
        ctx.globalAlpha = Math.min(1, t * 2) * (k === 0 ? 0.55 : 1);
        if (soft) {
          const spr = this.sprite(k === 0 ? 0 : k === 1 ? 1 : 2);
          const r = size * (k === 5 ? 0.6 + (1 - t) * 0.8 : 0.5);
          ctx.drawImage(spr, px - r, py - r, r * 2, r * 2);
        } else {
          const r = this.rot[i];
          const c = Math.cos(r);
          const sn = Math.sin(r);
          ctx.setTransform(dpr * c, dpr * sn, -dpr * sn, dpr * c, dpr * (px + offX), dpr * (py + offY));
          ctx.fillStyle = COLORS[this.color[i]];
          if (k === 4) {
            // Confetti flutters: a flat strip whose width breathes as it spins.
            const w = size * (0.35 + Math.abs(Math.cos(r * 1.7)) * 0.65);
            ctx.fillRect(-w / 2, -size * 0.3, w, size * 0.6);
          } else if (k === 2) {
            ctx.beginPath();
            ctx.moveTo(0, -size * 0.6);
            ctx.lineTo(size * 0.5, size * 0.4);
            ctx.lineTo(-size * 0.45, size * 0.3);
            ctx.closePath();
            ctx.fill();
          } else {
            ctx.fillRect(-size / 2, -size / 2, size, size);
          }
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, dpr * offX, dpr * offY);
  }

  /** Radial sprite in one colour, baked once per pool. */
  private sprite(key: number): HTMLCanvasElement {
    const hit = this.sprites.get(key);
    if (hit) return hit;
    const size = 48;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    const col = SOFT_SPRITES[key];
    g.addColorStop(0, col);
    g.addColorStop(0.45, `${col}80`);
    g.addColorStop(1, `${col}00`);
    ctx.fillStyle = g;
    if (key === 2) {
      // Glint: a four-point sparkle rather than a blob.
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      const m = size / 2;
      ctx.moveTo(m, 0);
      ctx.quadraticCurveTo(m, m, size, m);
      ctx.quadraticCurveTo(m, m, m, size);
      ctx.quadraticCurveTo(m, m, 0, m);
      ctx.quadraticCurveTo(m, m, m, 0);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      roundRect(ctx, m - 3, m - 3, 6, 6, 3);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, size, size);
    }
    this.sprites.set(key, c);
    return c;
  }

  clear() {
    this.life.fill(0);
    this.alive = 0;
    this.head = 0;
  }

  dispose() {
    this.clear();
    for (const c of this.sprites.values()) {
      c.width = 0;
      c.height = 0;
    }
    this.sprites.clear();
  }
}
