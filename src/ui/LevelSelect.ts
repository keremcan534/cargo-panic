/**
 * Level grid over a dimmed warehouse. Five columns of five; locked tiles stay
 * dark until the previous level is cleared.
 */

import * as THREE from 'three';
import type { AppContext, Screen } from '../app/Router';
import { gameScreen } from '../app/Game';
import { LEVELS, TOTAL_LEVELS } from '../game/levels/levels';
import { audio } from '../game/systems/AudioManager';
import { haptics } from '../game/systems/Haptics';
import { progress } from '../game/systems/ProgressManager';
import { Warehouse } from '../render/three/Warehouse';
import { menuScreen } from './Menu';
import { STAR_SVG, btn, el, fadeIn, fadeOut, iconBtn, uiRoot } from './dom';

export function levelSelectScreen(ctx: AppContext): Screen {
  const { renderer } = ctx;
  let root: HTMLElement;
  let warehouse: Warehouse;

  const start = (id: number) => {
    void fadeOut(180).then(() => ctx.router.go((c) => gameScreen(c, { levelId: id })));
  };

  return {
    enter() {
      renderer.frame(3, 7);
      warehouse = new Warehouse({ rackHalfWidth: 3.8 });
      renderer.scene.add(warehouse.group);

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
        progress.completedCount() === 0 ? 'START LEVEL 1' : `CONTINUE - LEVEL ${next}`,
        () => start(next),
        'primary',
        'md',
      );
      cont.dataset.role = 'continue';

      root = el('div', { class: 'screen levels fade-in' }, [
        el('div', { class: 'dim-3d' }),
        el('div', { class: 'head' }, [
          iconBtn('back', () => void fadeOut(180).then(() => ctx.router.go(menuScreen)), 'Back'),
          el('h1', { text: 'SELECT LEVEL' }),
          el('div'),
          el('div', { class: 'stars', text: `${progress.totalStars()} / ${TOTAL_LEVELS * 3} STARS COLLECTED` }),
        ]),
        grid,
        el('div', { class: 'foot' }, [cont, el('div', { class: 'hint', text: 'Clear a level to unlock the next one' })]),
      ]);
      uiRoot().append(root);
      fadeIn();
    },
    exit() {
      warehouse.dispose();
      root.remove();
      renderer.scene.remove(...renderer.scene.children.filter((o) => !(o instanceof THREE.Points)));
    },
  };
}
