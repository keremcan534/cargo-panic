/**
 * The first-session guide as a pure state machine (no DOM; the overlay in
 * Tutorial.ts draws it). One step per level, shown exactly when it is needed
 * and gone as soon as the player does the thing:
 *
 *   level 1 'place'   - from the start: put the belt package on the shelf.
 *                       Done on the first committed move.
 *   level 2 'preview' - when a package is first picked up or selected: the
 *                       meter's ghost needle shows where the rack will lean.
 *                       Done when the hand is empty again (placed or let go).
 *   level 3 'move'    - once a package is stowed: stowed packages can move.
 *                       Done when the player moves a stowed package.
 *
 * A step that is done never shows again; SKIP hides every step for good
 * (until REPLAY TUTORIAL in settings). Nothing here touches the game
 * session: skipping or finishing a step changes no rules state.
 */

export type TutorialStep = 'place' | 'preview' | 'move';

/** Where the flags live (progress.tutorial in the game, a plain object in tests). */
export interface TutorialStore {
  readonly done: readonly string[];
  readonly skipped: boolean;
  mark(step: TutorialStep): void;
  skip(): void;
}

/** The step a campaign level teaches, if any. */
export function stepForLevel(levelId: number | null): TutorialStep | null {
  if (levelId === 1) return 'place';
  if (levelId === 2) return 'preview';
  if (levelId === 3) return 'move';
  return null;
}

export class TutorialFlow {
  readonly step: TutorialStep | null;
  private shown = false;
  private over = false;

  constructor(
    levelId: number | null,
    private readonly store: TutorialStore,
  ) {
    const step = stepForLevel(levelId);
    this.step = step && !store.skipped && !store.done.includes(step) ? step : null;
    if (this.step === 'place') this.shown = true;
  }

  /** The step still to be taught on this shipment. */
  get active(): boolean {
    return this.step !== null && !this.over;
  }

  /** The step on screen now, or null. */
  get visible(): TutorialStep | null {
    return this.active && this.shown ? this.step : null;
  }

  /** A package is in the player's hand or selected (true), or the hand is empty (false). */
  hand(holding: boolean) {
    if (!this.active || this.step !== 'preview') return;
    if (holding) this.shown = true;
    else if (this.shown) this.complete();
  }

  /**
   * A committed move. `fromShelf`: the package was stowed before the move;
   * `stowed`: packages on the rack after it.
   */
  moved(fromShelf: boolean, stowed: number) {
    if (!this.active) return;
    if (this.step === 'place') {
      this.complete();
    } else if (this.step === 'move') {
      if (this.shown && fromShelf) this.complete();
      else if (stowed > 0) this.shown = true;
    }
  }

  /** SKIP TUTORIAL: every step is hidden from now on. */
  skip() {
    if (this.over && this.store.skipped) return;
    this.over = true;
    this.store.skip();
  }

  /** The shipment ended with the step untaught: hide it, it comes back next time. */
  end() {
    this.over = true;
  }

  private complete() {
    if (!this.step) return;
    this.over = true;
    this.store.mark(this.step);
  }
}
