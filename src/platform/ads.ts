/**
 * The ads boundary. OFF: the game ships with `NoAds`, so every hint stays free
 * and nothing here changes how the game behaves.
 *
 * No ad SDK is installed and no ad unit or app id exists in this repository.
 * Turning rewarded hints on later means writing one `AdProvider` (for example
 * over an AdMob Capacitor plugin) and passing it to `installAds` in main.ts;
 * the README ("Ads (off)") lists every step, including consent and the Play
 * Console declarations.
 */

import { setHintGate, type HintContext, type HintGate } from '../game/systems/HintService';

export type RewardedResult = 'rewarded' | 'dismissed' | 'failed';

export interface AdProvider {
  /** True only when a rewarded ad can actually be offered (SDK ready, consent settled). */
  isAvailable(): boolean;
  /**
   * Shows one rewarded ad. 'rewarded': the player earned the reward;
   * 'dismissed': closed early; 'failed': nothing could be shown.
   */
  showRewarded(): Promise<RewardedResult>;
}

/** The default: no ads, ever. */
export const NoAds: AdProvider = {
  isAvailable: () => false,
  showRewarded: () => Promise.resolve('failed'),
};

/** The brief's rule: no ad offers in the first three campaign levels. */
export const FREE_HINT_LEVELS = 3;

export function isFreeHint(context: HintContext | undefined): boolean {
  return context?.mode === 'campaign' && context.level <= FREE_HINT_LEVELS;
}

/**
 * A hint gate that grants the hint only after a completed rewarded ad
 * (free in the first campaign levels). One ad at a time: a second request
 * while one is showing is denied.
 */
export function rewardedHintGate(provider: AdProvider): HintGate {
  let showing = false;
  return (grant, deny, context) => {
    if (isFreeHint(context)) {
      grant();
      return;
    }
    if (showing) {
      deny();
      return;
    }
    showing = true;
    provider.showRewarded().then(
      (result) => {
        showing = false;
        if (result === 'rewarded') grant();
        else deny();
      },
      () => {
        showing = false;
        deny();
      },
    );
  };
}

/**
 * Puts the rewarded gate in front of the hint button only when the provider
 * can show ads; otherwise hints stay free. Returns whether the gate is on.
 */
export function installAds(provider: AdProvider = NoAds): boolean {
  if (!provider.isAvailable()) {
    setHintGate(null);
    return false;
  }
  setHintGate(rewardedHintGate(provider));
  return true;
}
