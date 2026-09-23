/**
 * Title screen: the stage's hero-rack backdrop with DOM controls over it.
 *
 * The settings button (top right, next to sound) shows the view drawing now
 * - "2D" or "3D" - next to a gear, so the 2D option is one tap away. It
 * opens the settings panel: VIEW, 3D QUALITY, sound and vibration.
 *
 * With a game in progress in the save, the first button is CONTINUE: the
 * saved level or shift, rebuilt paused (activePlay.resumeActive). PLAY and
 * ENDLESS still start fresh, which replaces the saved game; if that would
 * throw away a shift with points on it, the player is asked first. A saved
 * game that cannot be rebuilt is dropped with a message - records stay.
 */

import { resumeActive } from '../app/activePlay';
import type { AppContext, Screen, ScreenFactory } from '../app/Router';
import { gameScreen } from '../app/Game';
import { TOTAL_LEVELS } from '../game/levels/levels';
import type { ActivePlay } from '../game/save/schema';
import { audio } from '../game/systems/AudioManager';
import { haptics } from '../game/systems/Haptics';
import { progress } from '../game/systems/ProgressManager';
import { formatScore, newRun, seedFromUrl } from '../game/systems/RunManager';
import { t } from '../i18n';
import type { HeroBand } from '../render/hero';
import type { Backdrop, Stage } from '../render/Stage';
import { watchHeroBand } from './heroBand';
import { levelSelectScreen } from './LevelSelect';
import { ConfirmPanel, SettingsPanel } from './Panels';
import { showSaveMessage, storageWarning } from './SaveNotices';
import { viewControls } from './ViewSettings';
import { btn, el, fadeIn, fadeOut, iconBtn, setIcon, uiRoot } from './dom';

/**
 * Starting a new game replaces the saved one. When that would end a shift
 * that has points, ask first (`start` runs on yes); otherwise start at once.
 * Returns the question panel, or null.
 */
export function confirmFreshStart(start: () => void): ConfirmPanel | null {
  const active = progress.active;
  if (active?.kind !== 'endless' || active.run.score <= 0) {
    start();
    return null;
  }
  return new ConfirmPanel({
    title: t('menu.newShiftTitle'),
    body: t('menu.newShiftBody', { wave: active.run.wave, score: formatScore(active.run.score) }),
    confirm: t('menu.newShiftConfirm'),
    cancel: t('menu.newShiftCancel'),
    onConfirm: start,
  });
}

/**
 * CONTINUE: the saved game rebuilt, paused, and `go`ne to. If it cannot be
 * rebuilt, the player is told and only that game is dropped (records stay);
 * then it returns false and the caller shows its screen again, without it.
 */
export function continueGame(active: ActivePlay, go: (factory: ScreenFactory) => void): boolean {
  const r = resumeActive(active);
  if (r.ok) {
    go((c) => gameScreen(c, { resume: r.shipment }));
    return true;
  }
  progress.setActive(null);
  progress.flush();
  showSaveMessage(t('save.resumeFailed'), 'resume-failed');
  return false;
}

/** The CONTINUE label for the saved game. */
function continueLabel(): string | null {
  const a = progress.active;
  if (!a) return null;
  return a.kind === 'campaign' ? t('menu.continueLevel', { n: a.levelId }) : t('menu.continueShift', { n: a.run.wave });
}

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
  let question: ConfirmPanel | null = null;
  let offHost: (() => void) | undefined;
  /** The band between the tagline and the buttons, for the backdrop's hero rack (heroBand.ts). */
  let heroBand: HeroBand | null = null;
  let offBand: (() => void) | undefined;
  /** A screen change is on its way: a second tap starts nothing more. */
  let leaving = false;

  const go = (factory: ScreenFactory) => {
    if (leaving) return;
    leaving = true;
    void fadeOut(200).then(() => ctx.router.go(factory));
  };

  /** A new game, after asking if it would end a shift with points. */
  const startFresh = (factory: ScreenFactory) => {
    if (leaving || question) return;
    const asked = confirmFreshStart(() => go(factory));
    question = asked;
    asked?.onClosed(() => {
      if (question === asked) question = null;
    });
  };

  /** CONTINUE: the saved game rebuilt, paused. If it cannot be, say so and drop only that game. */
  const resume = () => {
    const active = progress.active;
    if (leaving || !active || continueGame(active, go)) return;
    leaving = true;
    ctx.router.go(menuScreen); // the menu again, without CONTINUE
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

      const resumeLabel = continueLabel();
      let cont: HTMLButtonElement | null = null;
      if (resumeLabel) {
        cont = btn(resumeLabel, resume, 'primary', 'lg');
        cont.dataset.role = 'continue';
      }
      // With CONTINUE on screen, PLAY names the level it starts fresh.
      const playLabel =
        done === 0
          ? t('menu.play')
          : cont
            ? t('menu.playLevel', { n: progress.unlocked })
            : t('menu.continueLevel', { n: progress.unlocked });
      const play = btn(
        playLabel,
        () => startFresh((c) => gameScreen(c, { levelId: progress.unlocked })),
        cont ? 'secondary' : 'primary',
        cont ? 'md' : 'lg',
      );
      play.dataset.role = 'play';
      const endlessBtn = btn(
        t('menu.endless'),
        () => startFresh((c) => gameScreen(c, { run: newRun(seedFromUrl()) })),
        'gold',
        'md',
      );
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
          storageWarning(),
          el('div', { class: 'chip' }, [
            el('span', { class: 'g', text: t('menu.starsChip', { stars, total: TOTAL_LEVELS * 3 }) }),
            el('span', { class: 'd', text: t('menu.clearedChip', { done, total: TOTAL_LEVELS }) }),
          ]),
          cont,
          play,
          ...endlessCaptions(),
          endlessBtn,
          levels,
          el('div', { class: 'studio', text: 'BLACKBLUE STUDIOS' }),
        ]),
      ]);
      uiRoot().append(root);
      offBand = watchHeroBand(root, root.querySelector('.tagline')!, root.querySelector('.bottom')!, (band) => {
        heroBand = band;
        backdrop?.setHeroBand?.(band);
      });
      if (opts.settings) openSettings();
      fadeIn();
    },
    exit() {
      offHost?.();
      offBand?.();
      settings?.dismissNow();
      settings = null;
      question?.dismissNow();
      question = null;
      backdrop?.dispose();
      backdrop = undefined;
      root.remove();
    },
    /** Android back: closes an open panel; on the bare title screen the app may exit. */
    back() {
      if (question) {
        question.cancel();
        question = null;
        return true;
      }
      if (settings) {
        const panel = settings;
        settings = null;
        panel.close();
        return true;
      }
      return false;
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
      backdrop.setHeroBand?.(heroBand);
    },
  };
}
