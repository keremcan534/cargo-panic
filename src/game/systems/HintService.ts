/**
 * Gate in front of the hint button.
 *
 * Today every hint is free and `requestHint` just runs the callback. The
 * indirection exists so a rewarded-video gate can be dropped in later by
 * calling `setHintGate` once at startup - gameplay code never changes.
 */

export type HintGate = (grant: () => void, deny: () => void) => void;

const FREE_GATE: HintGate = (grant) => grant();

let gate: HintGate = FREE_GATE;

/** Replace the gate, e.g. with one that shows a rewarded ad first. */
export function setHintGate(next: HintGate | null) {
  gate = next ?? FREE_GATE;
}

export function requestHint(grant: () => void, deny: () => void = () => undefined) {
  gate(grant, deny);
}
