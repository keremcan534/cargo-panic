/**
 * The one requestAnimationFrame loop in the app. Screens subscribe for game
 * updates; the current Stage draws last. Swapping stages never adds a loop.
 *
 * Nothing a frame runs can stop it: a subscriber (or the stage) that throws
 * is reported through `onError` (the app's recovery, see recovery.ts) and
 * the other subscribers, the drawing and the next frames carry on.
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
  /** The page was hidden since the last frame: that gap is never charged. */
  private skipGap = false;
  private watching = false;
  /** Drawn last each frame. Written only by StageHost (null while a stage is being swapped). */
  stage: Stage | null = null;
  /** Gets whatever a subscriber or the stage threw during a frame. main.ts points it at the app's recovery. */
  onError: (error: unknown) => void = (error) => console.error('[cargo-panic] frame callback failed', error);

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.handle = requestAnimationFrame(this.frame);
    this.watchVisibility();
  }

  /**
   * Time spent hidden (tab switch, screen lock, app in the background) is
   * never charged to the rules clocks, whichever of the first frame or the
   * 'visible' event arrives first.
   */
  private watchVisibility() {
    if (this.watching || typeof document === 'undefined') return;
    this.watching = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.skipGap = true;
      else this.resync();
    });
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
    let raw = Math.max(0, now - this.last);
    this.last = now;
    if (this.skipGap) {
      this.skipGap = false;
      raw = 0;
    }
    const anim = Math.min(MAX_STEP_MS, raw);
    const real = Math.min(MAX_FRAME_CATCHUP_MS, raw);
    this.frames++;
    try {
      this.stage?.tweens.update(anim);
    } catch (e) {
      this.report(e);
    }
    for (const cb of this.callbacks) {
      try {
        cb(anim, real);
      } catch (e) {
        this.report(e);
      }
    }
    // Re-read: a callback may have swapped the stage; never draw a disposed one.
    try {
      this.stage?.render(anim);
    } catch (e) {
      this.report(e);
    }
  };

  private report(error: unknown) {
    try {
      this.onError(error);
    } catch {
      // The reporter itself failed: the loop still runs.
    }
  }
}
