/**
 * 3D quality profiles and the adaptive "auto" ladder, as plain data and
 * arithmetic (no three.js), so the policy is unit-tested on its own.
 *
 *   low  - DPR 1, no bloom, no shadows, a reduced particle budget.
 *   high - DPR up to MAX_DPR, bloom, shadows.
 *   auto - starts at high. Each sustained slow stretch drops one step:
 *          bloom first, then shadows, then DPR 1 (with fewer particles).
 *
 * "Sustained slow" is the renderer's long-standing rule: a frame slower than
 * SLOW_FRAME_MS counts up, a fast one counts down by two, and passing
 * SLOW_FRAME_LIMIT is one slow stretch (~1.5 s at 60 fps). A slow stretch at
 * the lowest profile the preference allows (auto's last step, or low) marks
 * the stage as `struggling`; the game may then suggest the 2D view between
 * shipments. HIGH is the player's explicit choice: it never steps down and
 * never reports struggling.
 */

import type { QualityPref } from './Stage';

export interface QualityProfile {
  bloom: boolean;
  shadows: boolean;
  /** Upper bound for the renderer's pixel ratio. */
  dprCap: number;
  /** Share of the requested particles actually emitted (0..1). */
  particles: number;
}

/** Beyond this the framebuffer costs more than the sharpness is worth. */
export const MAX_DPR = 2;
/** A frame slower than this counts towards a slow stretch. */
export const SLOW_FRAME_MS = 26;
/** Slow-frame score that makes one slow stretch. */
export const SLOW_FRAME_LIMIT = 90;

export const HIGH_PROFILE: Readonly<QualityProfile> = Object.freeze({
  bloom: true,
  shadows: true,
  dprCap: MAX_DPR,
  particles: 1,
});

export const LOW_PROFILE: Readonly<QualityProfile> = Object.freeze({
  bloom: false,
  shadows: false,
  dprCap: 1,
  particles: 0.4,
});

/** The auto ladder, best first. */
export const AUTO_STEPS: readonly Readonly<QualityProfile>[] = Object.freeze([
  HIGH_PROFILE,
  Object.freeze({ bloom: false, shadows: true, dprCap: MAX_DPR, particles: 1 }),
  Object.freeze({ bloom: false, shadows: false, dprCap: MAX_DPR, particles: 1 }),
  Object.freeze({ bloom: false, shadows: false, dprCap: 1, particles: 0.6 }),
]);

export class QualityGovernor {
  private pref: QualityPref;
  private step = 0;
  private slowFrames = 0;
  private strugglingValue = false;

  constructor(pref: QualityPref = 'auto') {
    this.pref = pref;
  }

  get preference(): QualityPref {
    return this.pref;
  }

  /** Index on the auto ladder (always 0 unless the preference is auto). */
  get autoStep(): number {
    return this.pref === 'auto' ? this.step : 0;
  }

  get profile(): Readonly<QualityProfile> {
    if (this.pref === 'low') return LOW_PROFILE;
    if (this.pref === 'high') return HIGH_PROFILE;
    return AUTO_STEPS[this.step];
  }

  /** True after a slow stretch at the lowest profile the preference allows. */
  get struggling(): boolean {
    return this.strugglingValue;
  }

  /** A new preference starts over: auto begins at high again, struggling clears. */
  setPreference(pref: QualityPref) {
    this.pref = pref;
    this.step = 0;
    this.slowFrames = 0;
    this.strugglingValue = false;
  }

  /** Feeds one frame's duration. Returns true when the profile changed. */
  frame(dtMs: number): boolean {
    if (dtMs > SLOW_FRAME_MS) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 2);
    if (this.slowFrames <= SLOW_FRAME_LIMIT) return false;
    this.slowFrames = 0;
    if (this.pref === 'high') return false;
    if (this.pref === 'auto' && this.step < AUTO_STEPS.length - 1) {
      this.step++;
      return true;
    }
    this.strugglingValue = true;
    return false;
  }
}
