/**
 * Why the game is paused. Several things can hold a shipment still at once -
 * the pause panel, the cargo guide, a view switch in progress, the app being
 * in the background, a lost WebGL context - and each lets go on its own.
 *
 * The session is paused as soon as any reason holds and resumed only when
 * the last one is gone. So pressing RESUME while a view switch is still
 * running cannot start the hazard clocks on a blank screen: the 'switching'
 * reason still holds the session.
 */

export type PauseReason = 'menu' | 'legend' | 'switching' | 'hidden' | 'context-lost';

/** The part of GameSession this needs. pause() / resume() are no-ops outside play / paused. */
export interface Pausable {
  pause(): boolean;
  resume(): boolean;
}

export class PauseReasons {
  private held = new Set<PauseReason>();

  constructor(private readonly session: Pausable) {}

  add(reason: PauseReason) {
    this.held.add(reason);
    this.session.pause();
  }

  /** Drops a reason; resumes the session when it was the last. Returns false if it was not held. */
  remove(reason: PauseReason): boolean {
    if (!this.held.delete(reason)) return false;
    if (this.held.size === 0) this.session.resume();
    return true;
  }

  has(reason: PauseReason): boolean {
    return this.held.has(reason);
  }

  get size(): number {
    return this.held.size;
  }

  list(): PauseReason[] {
    return [...this.held];
  }
}
