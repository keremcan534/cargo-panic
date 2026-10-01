/**
 * Level grid over a dimmed warehouse. Five columns of five; locked tiles stay
 * dark until the previous level is cleared.
 *
 * A tile starts its level fresh. The button under the grid goes on with the
 * campaign: it continues the saved game when that is the campaign's next
 * level; with any other game saved it reads PLAY LEVEL N and starts fresh,
 * like the menu (asking first if that would end a shift with points).
 */

import type { AppContext, Screen, ScreenFactory } from '../app/Router';
import { gameScreen } from '../app/Game';
import { LEVELS, TOTAL_LEVELS } from '../game/levels/levels';
import { audio } from '../game/systems/AudioManager';
import { haptics } from '../game/systems/Haptics';
import { progress } from '../game/systems/ProgressManager';
import { t } from '../i18n';
import type { Backdrop, Stage } from '../render/Stage';
import { confirmFreshStart, continueGame, menuScreen } from './Menu';
import type { ConfirmPanel } from './Panels';
import { STAR_SVG, btn, el, fadeIn, fadeOut, iconBtn, uiRoot } from './dom';

export function levelSelectScreen(ctx: AppContext): Screen {
  let root: HTMLElement;
  let backdrop: Backdrop | undefined;
  let question: ConfirmPanel | null = null;
  let leaving = false;

  const leave = (factory: ScreenFactory) => {
    if (leaving) return;
    leaving = true;
    void fadeOut(180).then(() => ctx.router.go(factory));
  };

  /** A level starts fresh and replaces the saved game (asking first if that ends a shift with points). */
  const start = (id: number) => {
    if (leaving || question) return;
    const asked = confirmFreshStart(() => leave((c) => gameScreen(c, { levelId: id })));
    question = asked;
    asked?.onClosed(() => {
      if (question === asked) question = null;
    });
  };

  /** The saved game, rebuilt paused (as the menu's CONTINUE); if it cannot be, this screen again without it. */
  const resume = () => {
    const active = progress.active;
    if (leaving || question || !active || continueGame(active, leave)) return;
    leaving = true;
    ctx.router.go(levelSelectScreen);
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

      // The campaign's next level. When the saved game is that level, the button continues it. With
      // another game saved it starts the level fresh and says so, like the menu's PLAY LEVEL.
      const next = progress.unlocked;
      const active = progress.active;
      const resumes = active?.kind === 'campaign' && active.levelId === next;
      const fresh = !!active && !resumes;
      const label = resumes
        ? t('levels.continue', { n: next })
        : fresh
          ? t('menu.playLevel', { n: next })
          : progress.completedCount() === 0
            ? t('levels.start')
            : t('levels.continue', { n: next });
      const cont = btn(label, () => (resumes ? resume() : start(next)), 'primary', 'md');
      cont.dataset.role = fresh ? 'play' : 'continue';

      root = el('div', { class: 'screen levels fade-in' }, [
        el('div', { class: 'dim-3d' }),
        el('div', { class: 'head' }, [
          iconBtn('back', () => leave(menuScreen), t('levels.back')),
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
      question?.dismissNow();
      question = null;
      backdrop?.dispose();
      backdrop = undefined;
      root.remove();
    },
    /** Android back: closes the question if one is open, else back to the title screen. */
    back() {
      if (question) {
        question.cancel();
        question = null;
      } else {
        leave(menuScreen);
      }
      return true;
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
