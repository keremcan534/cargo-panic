/**
 * A renderer backend: one canvas, one tween clock, and factories for the game
 * view and the menu backdrops. The app holds exactly one Stage at a time and
 * disposes it completely before creating another, so two renderers never
 * draw at once.
 *
 * Stages do not own an animation loop. The app's FrameLoop calls `render`
 * once per frame; that keeps "exactly one draw loop" true by construction.
 */

import type { Tweens } from './Tween';
import type { GameView, RenderMode } from './GameView';

export type QualityPref = 'auto' | 'low' | 'high';
export type BackdropKind = 'menu' | 'levels';

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

  /** Draws one frame. Called by the app loop after game updates. */
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
