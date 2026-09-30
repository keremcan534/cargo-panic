/**
 * Gate in front of the hint button.
 *
 * Today every hint is free and `requestHint` just runs the callback. The
 * indirection exists so a rewarded-video gate can be dropped in later by
 * calling `setHintGate` once at startup - gameplay code never changes
 * (src/platform/ads.ts does that, and only when an ad provider is available).
 */

/** Where the hint was asked for, so a gate can keep early levels free. */
export interface HintContext {
  mode: 'campaign' | 'endless';
  /** Campaign level id, or the Endless wave number. */
  level: number;
}

export type HintGate = (grant: () => void, deny: () => void, context: HintContext | undefined) => void;

const FREE_GATE: HintGate = (grant) => grant();

let gate: HintGate = FREE_GATE;

/** Replace the gate, e.g. with one that shows a rewarded ad first; null restores free hints. */
export function setHintGate(next: HintGate | null) {
  gate = next ?? FREE_GATE;
}

export function requestHint(grant: () => void, deny: () => void = () => undefined, context?: HintContext) {
  gate(grant, deny, context);
}
