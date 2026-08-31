/**
 * Thin abstraction over device vibration so gameplay code never touches the
 * Vibration API directly. On desktop (and any device without it) every call is
 * a silent no-op; swapping in a Capacitor Haptics plugin later means editing
 * only this file.
 */

import { progress } from './ProgressManager';

type Pattern = number | number[];

function fire(pattern: Pattern) {
  if (!progress.hapticsOn) return;
  const nav = navigator as Navigator & { vibrate?: (p: Pattern) => boolean };
  if (typeof nav.vibrate !== 'function') return;
  try {
    nav.vibrate(pattern);
  } catch {
    /* some browsers throw when the page is not visible */
  }
}

export const haptics = {
  /** Light confirmation - picking a package up, tapping a button. */
  tap: () => fire(8),
  /** Standard placement. */
  place: () => fire(16),
  /** Heavy crate landing. */
  thud: () => fire([22, 26, 34]),
  /** Rejected drop. */
  reject: () => fire([14, 40, 14]),
  /** Entering a hazard state. */
  warn: () => fire([10, 60, 10, 60, 10]),
  /** Rack collapse. */
  crash: () => fire([40, 30, 70, 30, 120]),
  /** Level cleared. */
  win: () => fire([18, 50, 18, 50, 40]),
  setEnabled: (on: boolean) => progress.setHaptics(on),
  get enabled() {
    return progress.hapticsOn;
  },
};
