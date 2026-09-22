/**
 * Title screen: the stage's hero-rack backdrop with DOM controls over it.
 */

import type { AppContext, Screen } from '../app/Router';
import { gameScreen } from '../app/Game';
import { TOTAL_LEVELS } from '../game/levels/levels';
import { audio } from '../game/systems/AudioManager';
import { progress } from '../game/systems/ProgressManager';
import { formatScore, newRun, seedFromUrl } from '../game/systems/RunManager';
import type { Backdrop } from '../render/Stage';
import { levelSelectScreen } from './LevelSelect';
import { btn, el, fadeIn, fadeOut, iconBtn, setIcon, uiRoot } from './dom';

export function menuScreen(ctx: AppContext): Screen {
  let root: HTMLElement;
  let backdrop: Backdrop | undefined;

  const go = (factory: Parameters<typeof ctx.router.go>[0]) => {
    void fadeOut(200).then(() => ctx.router.go(factory));
  };

  return {
    enter() {
      backdrop = ctx.stage.showBackdrop('menu');

      const done = progress.completedCount();
      const stars = progress.totalStars();
      const endless = progress.endless;

      const soundBtn = iconBtn(progress.soundOn ? 'sound-on' : 'sound-off', () => {
        const on = !progress.soundOn;
        audio.setEnabled(on);
        setIcon(soundBtn, on ? 'sound-on' : 'sound-off');
        if (on) audio.click();
      }, 'Sound');

      const play = btn(
        done === 0 ? 'PLAY' : `CONTINUE - LEVEL ${progress.unlocked}`,
        () => go((c) => gameScreen(c, { levelId: progress.unlocked })),
        'primary',
        'lg',
      );
      play.dataset.role = 'play';
      const endlessBtn = btn('ENDLESS SHIFT', () => go((c) => gameScreen(c, { run: newRun(seedFromUrl()) })), 'gold', 'md');
      endlessBtn.dataset.role = 'endless';
      const levels = btn('LEVEL SELECT', () => go(levelSelectScreen), 'secondary', 'md');
      levels.dataset.role = 'levels';

      root = el('div', { class: 'screen menu fade-in' }, [
        el('div', { class: 'top' }, [soundBtn]),
        el('div', { class: 'wordmark' }, [
          el('div', { class: 'l1', text: 'CARGO' }),
          el('div', { class: 'l2', text: 'PANIC' }),
          el('div', { class: 'tagline', text: 'PACK THE WAREHOUSE WITHOUT TIPPING THE SHELVES' }),
        ]),
        el('div', { class: 'bottom' }, [
          el('div', { class: 'chip' }, [
            el('span', { class: 'g', text: `★ ${stars} / ${TOTAL_LEVELS * 3}` }),
            el('span', { class: 'd', text: `${done} / ${TOTAL_LEVELS} CLEARED` }),
          ]),
          play,
          el('div', {
            class: `caption ${endless.runs ? 'gold' : ''}`,
            text: endless.runs
              ? `BEST ${formatScore(endless.bestScore)}  -  WAVE ${endless.bestWave}`
              : 'PROCEDURAL WAVES - ONE MISTAKE ENDS A RUN',
          }),
          endlessBtn,
          levels,
          el('div', { class: 'studio', text: 'BLACKBLUE STUDIOS' }),
        ]),
      ]);
      uiRoot().append(root);
      fadeIn();
    },
    exit() {
      backdrop?.dispose();
      backdrop = undefined;
      root.remove();
    },
  };
}
