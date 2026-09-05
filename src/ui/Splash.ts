/**
 * BlackBlue Studios ident. Tap anywhere to skip.
 */

import type { AppContext, Screen } from '../app/Router';
import { audio } from '../game/systems/AudioManager';
import { menuScreen } from './Menu';
import { el, uiRoot } from './dom';

export function splashScreen(ctx: AppContext): Screen {
  let root: HTMLElement;
  let done = false;
  let timer = 0;

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    root.style.transition = 'opacity 260ms';
    root.style.opacity = '0';
    setTimeout(() => ctx.router.go(menuScreen), 270);
  };

  return {
    enter() {
      root = el('div', { class: 'screen splash tappable' }, [
        el('div', { class: 'mark' }, [el('span', { class: 'a', text: 'BLACK' }), el('span', { class: 'b', text: 'BLUE' })]),
        el('div', { class: 'sub', text: 'S T U D I O S' }),
      ]);
      root.addEventListener('pointerdown', () => {
        audio.unlock();
        finish();
      });
      uiRoot().append(root);
      timer = window.setTimeout(finish, 2000);
    },
    exit() {
      clearTimeout(timer);
      root.remove();
    },
  };
}
