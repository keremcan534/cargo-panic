/**
 * Title screen: the stage's hero-rack backdrop with DOM controls over it.
 *
 * The settings button (top right, next to sound) shows the view drawing now
 * - "2D" or "3D" - next to a gear, so the 2D option is one tap away. It
 * opens the settings panel: VIEW, 3D QUALITY, sound and vibration.
 */

import type { AppContext, Screen } from '../app/Router';
import { gameScreen } from '../app/Game';
import { TOTAL_LEVELS } from '../game/levels/levels';
import { audio } from '../game/systems/AudioManager';
import { haptics } from '../game/systems/Haptics';
import { progress } from '../game/systems/ProgressManager';
import { formatScore, newRun, seedFromUrl } from '../game/systems/RunManager';
import { t } from '../i18n';
import type { Backdrop, Stage } from '../render/Stage';
import { levelSelectScreen } from './LevelSelect';
import { SettingsPanel } from './Panels';
import { viewControls } from './ViewSettings';
import { btn, el, fadeIn, fadeOut, iconBtn, setIcon, uiRoot } from './dom';

/**
 * Under PLAY: the current ruleset's Endless best once a run has been played
 * (otherwise the pitch), plus the best from an older ruleset when the save
 * has one - shown apart, never mixed into the current record.
 */
function endlessCaptions(): HTMLElement[] {
  const endless = progress.endless;
  const out: HTMLElement[] = [
    el('div', {
      class: `caption ${endless.runs ? 'gold' : ''}`,
      text: endless.runs
        ? t('menu.endlessBest', { score: formatScore(endless.bestScore), wave: endless.bestWave })
        : t('menu.endlessPitch'),
    }),
  ];
  const prev = progress.previousEndless;
  if (prev) {
    const c = el('div', {
      class: 'caption previous',
      text: t('menu.endlessBestPrevious', { score: formatScore(prev.record.bestScore), wave: prev.record.bestWave }),
    });
    c.dataset.role = 'endless-previous';
    out.push(c);
  }
  return out;
}

export interface MenuOptions {
  /** Open the settings panel right away (re-entering after a language change). */
  settings?: boolean;
}

export function menuScreen(ctx: AppContext, opts: MenuOptions = {}): Screen {
  let root: HTMLElement;
  let backdrop: Backdrop | undefined;
  let settings: SettingsPanel | null = null;
  let offHost: (() => void) | undefined;

  const go = (factory: Parameters<typeof ctx.router.go>[0]) => {
    void fadeOut(200).then(() => ctx.router.go(factory));
  };

  return {
    enter() {
      backdrop = ctx.stage.showBackdrop('menu');

      const done = progress.completedCount();
      const stars = progress.totalStars();

      const soundBtn = iconBtn(progress.soundOn ? 'sound-on' : 'sound-off', () => {
        const on = !progress.soundOn;
        audio.setEnabled(on);
        setIcon(soundBtn, on ? 'sound-on' : 'sound-off');
        if (on) audio.click();
      }, t('menu.sound'));

      // Gear + the view drawing now: the 2D / 3D choice is visible from the title screen.
      const viewLabel = el('span', { class: 'mode', text: '' });
      const settingsBtn = el('button', { class: 'icon-btn view-btn' });
      settingsBtn.type = 'button';
      settingsBtn.dataset.role = 'settings';
      settingsBtn.title = t('menu.settings');
      settingsBtn.setAttribute('aria-label', t('menu.settings'));
      setIcon(settingsBtn, 'gear');
      settingsBtn.append(viewLabel);
      const showMode = () => {
        viewLabel.textContent = ctx.mode === '3d' ? t('settings.view3d') : t('settings.view2d');
      };
      showMode();
      settingsBtn.addEventListener('pointerdown', () => audio.unlock());
      const openSettings = () => {
        if (settings) return;
        settings = new SettingsPanel({
          view: viewControls(ctx),
          soundOn: progress.soundOn,
          hapticsOn: progress.hapticsOn,
          onToggleSound: () => {
            const on = !progress.soundOn;
            audio.setEnabled(on);
            setIcon(soundBtn, on ? 'sound-on' : 'sound-off');
            return on;
          },
          onToggleHaptics: () => {
            const on = !progress.hapticsOn;
            haptics.setEnabled(on);
            return on;
          },
          onReplayTutorial: () => progress.setTutorialSkipped(false),
          tutorialReplayable: progress.tutorial.skipped || progress.tutorial.done.length > 0,
          onClose: () => {
            settings = null;
          },
        });
      };
      settingsBtn.addEventListener('click', () => {
        if (settings) return;
        audio.click();
        haptics.tap();
        openSettings();
      });
      offHost = ctx.host.onEvent(showMode);

      const play = btn(
        done === 0 ? t('menu.play') : t('menu.continueLevel', { n: progress.unlocked }),
        () => go((c) => gameScreen(c, { levelId: progress.unlocked })),
        'primary',
        'lg',
      );
      play.dataset.role = 'play';
      const endlessBtn = btn(t('menu.endless'), () => go((c) => gameScreen(c, { run: newRun(seedFromUrl()) })), 'gold', 'md');
      endlessBtn.dataset.role = 'endless';
      const levels = btn(t('menu.levels'), () => go(levelSelectScreen), 'secondary', 'md');
      levels.dataset.role = 'levels';

      root = el('div', { class: 'screen menu fade-in' }, [
        el('div', { class: 'top' }, [settingsBtn, soundBtn]),
        el('div', { class: 'wordmark' }, [
          el('div', { class: 'l1', text: 'CARGO' }),
          el('div', { class: 'l2', text: 'PANIC' }),
          el('div', { class: 'tagline', text: t('menu.tagline') }),
        ]),
        el('div', { class: 'bottom' }, [
          el('div', { class: 'chip' }, [
            el('span', { class: 'g', text: t('menu.starsChip', { stars, total: TOTAL_LEVELS * 3 }) }),
            el('span', { class: 'd', text: t('menu.clearedChip', { done, total: TOTAL_LEVELS }) }),
          ]),
          play,
          ...endlessCaptions(),
          endlessBtn,
          levels,
          el('div', { class: 'studio', text: 'BLACKBLUE STUDIOS' }),
        ]),
      ]);
      uiRoot().append(root);
      if (opts.settings) openSettings();
      fadeIn();
    },
    exit() {
      offHost?.();
      settings?.dismissNow();
      settings = null;
      backdrop?.dispose();
      backdrop = undefined;
      root.remove();
    },
    /** Rebuilt in the new language, with the settings panel (where the language was picked) open. */
    languageChanged() {
      const reopen = settings !== null;
      ctx.router.go((c) => menuScreen(c, { settings: reopen }));
    },
    detachStage() {
      backdrop?.dispose();
      backdrop = undefined;
    },
    attachStage(stage: Stage) {
      backdrop = stage.showBackdrop('menu');
    },
  };
}
