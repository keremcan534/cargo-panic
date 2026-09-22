/**
 * The one requestAnimationFrame loop in the app. Screens subscribe for game
 * updates; the current Stage draws last. Swapping stages never adds a loop.
 */

import { MAX_FRAME_CATCHUP_MS, MAX_STEP_MS } from '../game/config';
import type { Stage } from '../render/Stage';

/**
 * `animMs` - capped frame time for animation (tweens, easing, particles).
 * `realMs` - real time for the rules clocks, capped only against stalls. Feed
 * it to GameSession.advance(), which sub-steps it, so a slow frame rate never
 * buys the player extra seconds on a hazard.
 */
export type FrameCallback = (animMs: number, realMs: number) => void;

export class FrameLoop {
  private callbacks = new Set<FrameCallback>();
  private handle = 0;
  private last = 0;
  private running = false;
  stage: Stage | null = null;

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.handle = requestAnimationFrame(this.frame);
  }

  /** Forget the last frame time (after the page was hidden) so no gap is charged. */
  resync() {
    this.last = performance.now();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.handle);
    this.handle = 0;
  }

  onFrame(cb: FrameCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  get subscribers(): number {
    return this.callbacks.size;
  }

  /** Frames drawn since start (for tests and frame-time sampling). */
  frames = 0;

  private frame = (now: number) => {
    if (!this.running) return;
    this.handle = requestAnimationFrame(this.frame);
    const raw = Math.max(0, now - this.last);
    this.last = now;
    const anim = Math.min(MAX_STEP_MS, raw);
    const real = Math.min(MAX_FRAME_CATCHUP_MS, raw);
    this.frames++;
    this.stage?.tweens.update(anim);
    for (const cb of this.callbacks) cb(anim, real);
    // Re-read: a callback may have swapped the stage; never draw a disposed one.
    this.stage?.render(anim);
  };
}
