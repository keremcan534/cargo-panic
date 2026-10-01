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
import type { HeroBand } from './hero';

export type QualityPref = 'auto' | 'low' | 'high';
export type BackdropKind = 'menu' | 'levels';

/** A rectangle in CSS pixels from the top-left of the stage canvas (the UI root covers the same box). */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A decorative scene behind a menu. Re-framed by the Stage on resize. */
export interface Backdrop {
  /**
   * The title screen's backdrop: the band its text and buttons leave free
   * (null: none known). The hero rack is fitted into it by hero.ts fitHero -
   * left alone, moved, shrunk or hidden - again on each new band and on
   * resize. Other backdrops do not have it.
   */
  setHeroBand?(band: HeroBand | null): void;
  dispose(): void;
}

export interface StageOptions {
  reducedMotion: boolean;
  quality: QualityPref;
}

/**
 * The drawing context went away ('lost') or came back ('restored'). Only the
 * 3D stage reports these: a WebGL context loss, or a shader that fails to
 * compile mid-game (reported as 'lost', never followed by 'restored').
 */
export type StageContextEvent = 'lost' | 'restored';

export interface Stage {
  readonly mode: RenderMode;
  readonly canvas: HTMLCanvasElement;
  readonly tweens: Tweens;

  createGameView(): GameView;
  /** Decorative scene behind a menu screen. */
  showBackdrop(kind: BackdropKind): Backdrop;
  /**
   * Where the title screen's hero rack is drawn right now (the projection of
   * its frame, feet and labels at the current sway), or null when no menu
   * backdrop is showing it. For tests and debugging.
   */
  heroRect?(): ScreenRect | null;

  setReducedMotion(on: boolean): void;
  /** 3D quality profile; the 2D stage ignores it. */
  setQuality(q: QualityPref): void;
  /** True after sustained slow frames even at the lowest profile (3D only). */
  readonly struggling: boolean;

  /**
   * Subscribes to context loss / restore (see StageContextEvent). Returns the
   * unsubscribe function. The 2D stage never reports anything (a 2D canvas
   * restores itself and is redrawn every frame).
   */
  onContextEvent(cb: (e: StageContextEvent) => void): () => void;

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
