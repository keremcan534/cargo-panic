/**
 * The Canvas 2D renderer backend: one <canvas id="game-canvas">, its 2D
 * context, a tween clock, the particle pool and the shared cargo-art cache.
 *
 * It owns no animation loop: the app's FrameLoop calls `render(dt)` once per
 * frame, which advances particles and backdrops and draws whatever is
 * attached (the game view or a menu backdrop). It never calls GameView.update;
 * the controller does.
 *
 * The backing store is the canvas' CSS size x min(2, devicePixelRatio). A
 * resize (or a DPR change, e.g. moving the window to another screen) re-lays
 * out and re-bakes every attached layer; nothing is re-baked per frame.
 */

import { Tweens } from '../Tween';
import type { GameView } from '../GameView';
import { StageInitError } from '../Stage';
import type {
  Backdrop,
  BackdropKind,
  QualityPref,
  ScreenRect,
  Stage,
  StageContextEvent,
  StageOptions,
} from '../Stage';
import { LevelsBackdrop2D, MenuBackdrop2D } from './backdrops2d';
import { Canvas2DGameView } from './Canvas2DGameView';
import { Particles2D } from './Particles2D';
import { ArtCache } from './sprites2d';
import type { Host2D, Layer2D } from './types2d';

/** Beyond this the backing store costs more than the sharpness is worth (same cap as 3D). */
const MAX_DPR = 2;
const CLEAR = '#0d1117';

export class Canvas2DStage implements Stage, Host2D {
  readonly mode = '2d' as const;
  readonly canvas: HTMLCanvasElement;
  readonly tweens = new Tweens();
  readonly particles = new Particles2D();
  readonly art = new ArtCache();
  /** Never true in 2D: there is no lower profile to fall back to. */
  readonly struggling = false;

  width = 1;
  height = 1;
  dpr = 1;

  private ctx: CanvasRenderingContext2D;
  private layers: Layer2D[] = [];
  private observer: ResizeObserver | null = null;
  private reduced: boolean;
  private disposed = false;

  constructor(
    private root: HTMLElement,
    opts: StageOptions,
  ) {
    this.reduced = opts.reducedMotion;
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new StageInitError('2d', 'no 2D canvas context');
    this.canvas = canvas;
    this.ctx = ctx;
    root.appendChild(canvas);
    this.measure();
    // Size changes arrive as events; nothing reads layout per frame.
    window.addEventListener('resize', this.onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.onResize);
      this.observer.observe(root);
    }
  }

  get reducedMotion(): boolean {
    return this.reduced;
  }

  // --- Stage -----------------------------------------------------------------

  createGameView(): GameView {
    this.assertLive();
    return new Canvas2DGameView(this);
  }

  showBackdrop(kind: BackdropKind): Backdrop {
    this.assertLive();
    return kind === 'menu' ? new MenuBackdrop2D(this) : new LevelsBackdrop2D(this);
  }

  heroRect(): ScreenRect | null {
    for (const layer of this.layers) if (layer instanceof MenuBackdrop2D) return layer.heroRect();
    return null;
  }

  setReducedMotion(on: boolean) {
    this.reduced = on;
  }

  setQuality(_q: QualityPref) {
    // The 2D renderer has a single profile.
  }

  /** A 2D canvas that loses its backing store gets it back by itself and is redrawn next frame. */
  onContextEvent(_cb: (e: StageContextEvent) => void): () => void {
    return () => undefined;
  }

  render(dtMs: number) {
    if (this.disposed) return;
    // A DPR change (window moved to another screen, zoom) fires no resize everywhere.
    if (Math.min(MAX_DPR, window.devicePixelRatio || 1) !== this.dpr) this.measure();
    const dt = Math.max(0, dtMs);
    this.particles.update(dt);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.layers.length === 0) {
      ctx.fillStyle = CLEAR;
      ctx.fillRect(0, 0, this.width, this.height);
      return;
    }
    for (const layer of this.layers) {
      layer.draw(ctx, dt);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  }

  dispose() {
    if (this.disposed) return;
    window.removeEventListener('resize', this.onResize);
    this.observer?.disconnect();
    this.observer = null;
    // Views and backdrops should be gone already; release any the app left behind.
    for (const layer of [...this.layers]) layer.dispose();
    this.disposed = true;
    this.layers = [];
    this.tweens.clear();
    this.particles.dispose();
    this.art.dispose();
    this.canvas.remove();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  // --- Host2D ------------------------------------------------------------------

  attach(layer: Layer2D) {
    if (this.layers.includes(layer)) return;
    this.layers.push(layer);
    layer.resize(this.width, this.height, this.dpr);
  }

  detach(layer: Layer2D) {
    const i = this.layers.indexOf(layer);
    if (i >= 0) this.layers.splice(i, 1);
  }

  // --- sizing ------------------------------------------------------------------

  private onResize = () => this.measure();

  private measure() {
    if (this.disposed) return;
    const w = Math.max(1, this.root.clientWidth);
    const h = Math.max(1, this.root.clientHeight);
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    const changed = w !== this.width || h !== this.height || dpr !== this.dpr;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    if (changed) for (const layer of this.layers) layer.resize(w, h, dpr);
  }

  private assertLive() {
    if (this.disposed) throw new StageInitError('2d', 'stage already disposed');
  }
}
