/**
 * Level grid over a dimmed warehouse. Five columns of five; locked tiles stay
 * dark until the previous level is cleared.
 */

import type { AppContext, Screen } from '../app/Router';
import { gameScreen } from '../app/Game';
import { LEVELS, TOTAL_LEVELS } from '../game/levels/levels';
import { audio } from '../game/systems/AudioManager';
import { haptics } from '../game/systems/Haptics';
import { progress } from '../game/systems/ProgressManager';
import { t } from '../i18n';
import type { Backdrop, Stage } from '../render/Stage';
import { menuScreen } from './Menu';
import { STAR_SVG, btn, el, fadeIn, fadeOut, iconBtn, uiRoot } from './dom';

export function levelSelectScreen(ctx: AppContext): Screen {
  let root: HTMLElement;
  let backdrop: Backdrop | undefined;

  const start = (id: number) => {
    void fadeOut(180).then(() => ctx.router.go((c) => gameScreen(c, { levelId: id })));
  };

  return {
    enter() {
      backdrop = ctx.stage.showBackdrop('levels');

      const grid = el('div', { class: 'grid' });
      for (const level of LEVELS) {
        const unlocked = progress.isUnlocked(level.id);
        const stars = progress.starsFor(level.id);
        const cls = ['tile', unlocked ? '' : 'locked', stars > 0 ? 'done' : '', stars === 3 ? 'three' : ''].join(' ');
        const tile = el('button', { class: cls });
        tile.type = 'button';
        tile.dataset.level = String(level.id);
        if (unlocked) {
          tile.append(
            el('div', { text: String(level.id) }),
            el(
              'div',
              { class: 'row' },
              [0, 1, 2].map((i) => el('i', { html: STAR_SVG(i < stars) })),
            ),
          );
          tile.addEventListener('pointerdown', () => audio.unlock());
          tile.addEventListener('click', () => {
            audio.click();
            haptics.tap();
            start(level.id);
          });
        } else {
          tile.innerHTML =
            '<svg class="lock" viewBox="0 0 24 24" fill="#3a4658"><rect x="5" y="10" width="14" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="#3a4658" stroke-width="2.6"/></svg>';
        }
        grid.append(tile);
      }

      const next = progress.unlocked;
      const cont = btn(
        progress.completedCount() === 0 ? t('levels.start') : t('levels.continue', { n: next }),
        () => start(next),
        'primary',
        'md',
      );
      cont.dataset.role = 'continue';

      root = el('div', { class: 'screen levels fade-in' }, [
        el('div', { class: 'dim-3d' }),
        el('div', { class: 'head' }, [
          iconBtn('back', () => void fadeOut(180).then(() => ctx.router.go(menuScreen)), t('levels.back')),
          el('h1', { text: t('levels.title') }),
          el('div'),
          el('div', { class: 'stars', text: t('levels.stars', { stars: progress.totalStars(), total: TOTAL_LEVELS * 3 }) }),
        ]),
        grid,
        el('div', { class: 'foot' }, [cont, el('div', { class: 'hint', text: t('levels.hint') })]),
      ]);
      uiRoot().append(root);
      fadeIn();
    },
    exit() {
      backdrop?.dispose();
      backdrop = undefined;
      root.remove();
    },
    languageChanged() {
      ctx.router.go(levelSelectScreen);
    },
    detachStage() {
      backdrop?.dispose();
      backdrop = undefined;
    },
    attachStage(stage: Stage) {
      backdrop = stage.showBackdrop('levels');
    },
  };
}
