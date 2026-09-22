/**
 * A renderer backend: one canvas, one tween clock, and factories for the game
 * view and the menu backdrops. The app holds exactly one Stage at a time and
 * disposes it completely before creating another, so two renderers never
 * draw at once.
 *
 * Stages do not own an animation loop. The app's FrameLoop calls `render`
 * once per frame; that keeps "exactly one draw loop" true by construction.
 *
 * Ownership: the Stage owns its canvas and context (WebGL renderer, post
 * chain, render targets for 3D), the resize listener, the particle pool, the
 * shared material/texture caches and the tween clock. A GameView or Backdrop
 * owns everything it creates under its own root and releases it in its own
 * dispose(). Stage.dispose() releases the rest - including the WebGL context
 * (forceContextLoss) - and leaves nothing reachable from module-level caches.
 */

import type { Tweens } from './Tween';
import type { GameView, RenderMode } from './GameView';

export type QualityPref = 'auto' | 'low' | 'high';
export type BackdropKind = 'menu' | 'levels';

/** A decorative scene behind a menu. Re-framed by the Stage on resize. */
export interface Backdrop {
  dispose(): void;
}

export interface StageOptions {
  reducedMotion: boolean;
  quality: QualityPref;
}

export interface Stage {
  readonly mode: RenderMode;
  readonly canvas: HTMLCanvasElement;
  readonly tweens: Tweens;

  createGameView(): GameView;
  /** Decorative scene behind a menu screen. */
  showBackdrop(kind: BackdropKind): Backdrop;

  setReducedMotion(on: boolean): void;
  /** 3D quality profile; the 2D stage ignores it. */
  setQuality(q: QualityPref): void;
  /** True after sustained slow frames even at the lowest profile (3D only). */
  readonly struggling: boolean;

  /**
   * Draws one frame. Called by the app loop after game updates. Advances
   * particles and the current backdrop; never calls GameView.update (only the
   * controller does), so nothing animates twice per frame.
   */
  render(dtMs: number): void;
  /** Releases the canvas, its context and everything drawn with it. */
  dispose(): void;
}

export class StageInitError extends Error {
  constructor(
    readonly mode: RenderMode,
    cause: unknown,
  ) {
    super(`cannot start ${mode} renderer: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
