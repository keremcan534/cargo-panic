/**
 * Internal plumbing between the 2D stage and what it draws. A layer (the game
 * view or a menu backdrop) is attached to the stage while it exists; the stage
 * tells it about size changes and asks it to draw once per frame.
 */

import type { Tweens } from '../Tween';
import type { Particles2D } from './Particles2D';
import type { ArtCache } from './sprites2d';

export interface Layer2D {
  /** Canvas size in CSS pixels and the backing-store ratio. Called on attach and on every change. */
  resize(width: number, height: number, dpr: number): void;
  /** Draws one frame. `dtMs` animates backdrops; the game view animates in GameView.update. */
  draw(ctx: CanvasRenderingContext2D, dtMs: number): void;
  dispose(): void;
}

/** What a layer may use from the stage that owns it. */
export interface Host2D {
  readonly canvas: HTMLCanvasElement;
  readonly tweens: Tweens;
  readonly particles: Particles2D;
  readonly art: ArtCache;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly reducedMotion: boolean;
  attach(layer: Layer2D): void;
  detach(layer: Layer2D): void;
}
