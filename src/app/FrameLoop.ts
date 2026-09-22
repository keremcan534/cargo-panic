/**
 * The one requestAnimationFrame loop in the app. Screens subscribe for game
 * updates; the current Stage draws last. Swapping stages never adds a loop.
 */

import type { Stage } from '../render/Stage';

export type FrameCallback = (dtMs: number) => void;

/** Longest step fed to the game, so a stall never fast-forwards the clocks. */
const MAX_STEP_MS = 50;

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

  private frame = (now: number) => {
    if (!this.running) return;
    this.handle = requestAnimationFrame(this.frame);
    const dt = Math.min(MAX_STEP_MS, Math.max(0, now - this.last));
    this.last = now;
    const stage = this.stage;
    stage?.tweens.update(dt);
    for (const cb of this.callbacks) cb(dt);
    stage?.render(dt);
  };
}
