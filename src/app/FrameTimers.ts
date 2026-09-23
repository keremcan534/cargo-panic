/**
 * Delays on the frame clock. The game screen's outcome and between-wave
 * delays (win panel, loss panel, next Endless wave) run here instead of on
 * window.setTimeout: they only move when the frame loop feeds them time, so
 * they freeze while the app is hidden (no frames are drawn, and the gap is
 * never charged - see FrameLoop) and cannot deal a wave in the background.
 */

interface Pending {
  left: number;
  fn: () => void;
  done: boolean;
}

export class FrameTimers {
  private list: Pending[] = [];

  /** Runs `fn` once `ms` of frame time has passed. Returns a cancel function. */
  after(ms: number, fn: () => void): () => void {
    const p: Pending = { left: Math.max(0, ms), fn, done: false };
    this.list.push(p);
    return () => {
      p.done = true;
    };
  }

  /**
   * Feeds `dtMs` of frame time. Timers that come due run in the order they
   * fell due (ties: the order they were set); one set during this call
   * waits for the next.
   */
  update(dtMs: number) {
    if (!(dtMs > 0) || this.list.length === 0) return;
    const due: Pending[] = [];
    for (const p of this.list) {
      if (p.done) continue;
      p.left -= dtMs;
      if (p.left <= 0) due.push(p);
    }
    due.sort((a, b) => a.left - b.left);
    for (const p of due) {
      if (p.done) continue; // cancelled by a timer that ran just before it
      p.done = true;
      p.fn();
    }
    this.list = this.list.filter((p) => !p.done);
  }

  /** Cancels everything (the screen is going away). */
  clear() {
    for (const p of this.list) p.done = true;
    this.list = [];
  }

  get pending(): number {
    return this.list.filter((p) => !p.done).length;
  }
}
