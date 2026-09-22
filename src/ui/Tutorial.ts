/**
 * The first-session guide overlay (levels 1-3). A short line of text, a
 * pointer exactly where the action is, and a SKIP TUTORIAL button - nothing
 * else. It never pauses the game and takes no input except the SKIP button
 * (pointer-events: none everywhere else), so the board underneath plays
 * exactly as without it. What to show and when lives in tutorialFlow.ts.
 *
 * Positions come from the view (clientPointOf) and the meter's ghost needle,
 * re-read every frame because the rack leans and packages move. Under reduced
 * motion the hand stands still at the package and a ring marks the target.
 */

import { t } from '../i18n';
import type { ClientPoint } from '../render/GameView';
import { btn, el, uiRoot } from './dom';
import type { TutorialFlow, TutorialStep } from './tutorialFlow';

/** A pointing hand; the fingertip is at (22, 3) in the 48 x 48 box. */
const HAND_SVG =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18.5 7a3.5 3.5 0 0 1 7 0v15.5l1.6-.9a3.6 3.6 0 0 1 4.9 1.7l.4.9 1.7-.5a3.6 3.6 0 0 1 4.4 2.4l.3.9 1-.2a3.4 3.4 0 0 1 4 3.2V36c0 6.6-5.4 10.5-11.5 10.5h-4.6c-4.4 0-7.3-1.8-9.3-5.3L8.6 30.7a3.2 3.2 0 0 1 5-3.9l4.9 4.6z" fill="#eef4ff" stroke="#06121f" stroke-width="2.6" stroke-linejoin="round"/></svg>';
const TIP = { x: 22, y: 3 };
const HAND_PX = 52;
/** One trip of the demonstration hand, package to slot. */
const TRIP_MS = 1900;

export interface TutorialFrame {
  dtMs: number;
  /** A package is pressed, dragged or selected. */
  holding: boolean;
  /** The hazard banner is up (the card steps aside for it). */
  hazard: boolean;
  reducedMotion: boolean;
  /** view.clientPointOf, or null while no view is live. */
  pointOf: ((target: { cargo: number } | { shelf: number; slot: number; slots: number }) => ClientPoint | null) | null;
  /** The live belt package. */
  live: number | null;
  /** Level 1: a good slot for the live package (from the solver, not session.hint). */
  placeTarget: { shelf: number; slot: number; slots: number } | null;
  /** Level 3: a stowed package to point at. */
  stowed: number | null;
  /** Level 2: just under the meter's ghost needle. */
  ghostNeedle: ClientPoint | null;
}

export class Tutorial {
  private root: HTMLElement;
  private text: HTMLElement;
  private hand: HTMLElement;
  private ring: HTMLElement;
  private arrow: HTMLElement;
  private time = 0;
  private shownStep: TutorialStep | null = null;
  /**
   * 'place' / 'move' cards sit over the meter band: once the player has
   * picked something up they have read it, so the card goes for good and
   * only the pointer stays (the meter is theirs again).
   */
  private cardRead = false;
  private gone = false;

  constructor(
    private readonly flow: TutorialFlow,
    private readonly onSkip: () => void = () => undefined,
  ) {
    this.text = el('div', { class: 'tut-text' });
    const skip = btn(t('tutorial.skip'), () => this.skip(), 'ghost', 'sm', 'tut-skip');
    skip.dataset.role = 'skip-tutorial';
    this.hand = el('div', { class: 'tut-hand', html: HAND_SVG });
    this.ring = el('div', { class: 'tut-ring' });
    this.arrow = el('div', { class: 'tut-arrow' });
    this.root = el('div', { class: 'tutorial' }, [
      this.ring,
      this.arrow,
      this.hand,
      el('div', { class: 'tut-card' }, [this.text, skip]),
    ]);
    this.root.dataset.role = 'tutorial';
    this.root.hidden = true;
    uiRoot().append(this.root);
  }

  /** The step on screen, or null. */
  get step(): TutorialStep | null {
    return this.gone ? null : this.flow.visible;
  }

  /** Still has something to teach on this shipment. */
  get alive(): boolean {
    return !this.gone;
  }

  /** Re-reads the copy after a language change. */
  relabel() {
    this.shownStep = null;
    const skip = this.root.querySelector('[data-role="skip-tutorial"]');
    if (skip) skip.textContent = t('tutorial.skip');
  }

  update(f: TutorialFrame) {
    if (this.gone) return;
    this.time += f.dtMs;
    this.flow.hand(f.holding);
    const step = this.flow.visible;
    if (!step) {
      if (!this.flow.active) this.dispose();
      else this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    if (step !== this.shownStep) {
      if (this.shownStep !== null) this.cardRead = false;
      this.shownStep = step;
      this.root.dataset.step = step;
      this.text.textContent =
        step === 'place' ? `${t('tutorial.place')}\n${t('tutorial.placeTap')}` : t(step === 'preview' ? 'tutorial.preview' : 'tutorial.move');
    }
    if (f.holding && step !== 'preview') this.cardRead = true;
    this.root.classList.toggle('aside', f.hazard);
    this.root.classList.toggle('holding', f.holding);
    this.root.classList.toggle('read', this.cardRead);

    let hand: ClientPoint | null = null;
    let ring: ClientPoint | null = null;
    let arrow: ClientPoint | null = null;
    if (step === 'place' && f.pointOf && f.live !== null && f.placeTarget) {
      const from = f.pointOf({ cargo: f.live });
      const to = f.pointOf(f.placeTarget);
      if (from && to) {
        ring = to;
        if (f.reducedMotion) {
          hand = from;
        } else {
          // Press on the package, travel to the slot, rest, repeat.
          const p = (this.time % TRIP_MS) / TRIP_MS;
          const k = p < 0.2 ? 0 : p > 0.8 ? 1 : ease((p - 0.2) / 0.6);
          hand = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
        }
      }
    } else if (step === 'move' && f.pointOf && f.stowed !== null) {
      const at = f.pointOf({ cargo: f.stowed });
      if (at) {
        const bob = f.reducedMotion ? 0 : Math.abs(Math.sin((this.time / 600) * Math.PI)) * 8;
        hand = { x: at.x, y: at.y + bob };
      }
    } else if (step === 'preview' && f.ghostNeedle) {
      arrow = f.ghostNeedle;
    }
    place(this.hand, hand, -TIP.x * (HAND_PX / 48), -TIP.y * (HAND_PX / 48));
    place(this.ring, ring, 0, 0);
    place(this.arrow, arrow, 0, 0);
  }

  /** A committed move (see TutorialFlow.moved); a finished step leaves on the next frame. */
  moved(fromShelf: boolean, stowed: number) {
    if (!this.gone) this.flow.moved(fromShelf, stowed);
  }

  /** SKIP TUTORIAL: the flags are saved and the overlay goes; the game carries on untouched. */
  skip() {
    if (this.gone) return;
    this.flow.skip();
    this.dispose();
    this.onSkip();
  }

  /** The shipment is over: hide without marking the step done. */
  end() {
    this.flow.end();
    this.dispose();
  }

  dispose() {
    if (this.gone) return;
    this.gone = true;
    this.root.remove();
  }
}

function ease(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

/** Moves an overlay element to a client point (plus an offset), or hides it. */
function place(e: HTMLElement, p: ClientPoint | null, dx: number, dy: number) {
  if (!p) {
    e.style.display = 'none';
    return;
  }
  e.style.display = '';
  e.style.transform = `translate(${Math.round(p.x + dx)}px, ${Math.round(p.y + dy)}px)`;
}
