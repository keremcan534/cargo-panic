/**
 * Modal overlays: level cleared, level failed, pause, settings, a yes / no
 * question, cargo guide, run over - plus the non-blocking wave-clear,
 * coaching and suggestion cards. All DOM; every string comes from the text
 * dictionary (src/i18n).
 */

import { PACKAGE_SPECS } from '../game/levels/types';
import type { PackageType } from '../game/levels/types';
import { audio } from '../game/systems/AudioManager';
import { formatScore, formatSeed } from '../game/systems/RunManager';
import type { ScoreLine, WaveResult } from '../game/systems/RunManager';
import { fmt, t } from '../i18n';
import { STAR_SVG, btn, el, uiRoot } from './dom';
import type { BtnStyle } from './dom';
import { viewSection } from './ViewSettings';
import type { ViewControls } from './ViewSettings';

// ---------------------------------------------------------------------------

class Modal {
  protected root: HTMLElement;
  protected card: HTMLElement;
  private closing = false;
  /** Run once when the panel starts closing (unsubscribe listeners and the like). */
  protected cleanups: (() => void)[] = [];

  constructor() {
    this.card = el('div', { class: 'card' });
    this.root = el('div', { class: 'modal' }, [this.card]);
    uiRoot().append(this.root);
    requestAnimationFrame(() => this.root.classList.add('on'));
  }

  get open(): boolean {
    return !this.closing;
  }

  /** Runs `fn` once when the panel starts closing, whichever way it closes. */
  onClosed(fn: () => void) {
    if (this.closing) fn();
    else this.cleanups.push(fn);
  }

  close(after?: () => void) {
    if (this.closing) return;
    this.closing = true;
    for (const fn of this.cleanups.splice(0)) fn();
    this.root.classList.add('leave');
    setTimeout(() => {
      this.root.remove();
      after?.();
    }, 190);
  }

  /** Gone at once, with no callback (the screen is being rebuilt, e.g. in another language). */
  dismissNow() {
    if (this.closing) return;
    this.closing = true;
    for (const fn of this.cleanups.splice(0)) fn();
    this.root.remove();
  }

  protected kicker(t: string) {
    this.card.append(el('div', { class: 'kicker', text: t }));
  }
  protected headline(t: string, tone: 'good' | 'bad' | '' = '') {
    this.card.append(el('div', { class: `headline ${tone}`, text: t }));
  }
  protected body(t: string) {
    this.card.append(el('div', { class: 'body', text: t }));
  }
  protected note(t: string, tone: 'gold' | 'accent' | 'warn' | 'dim' | 'warm') {
    const n = el('div', { class: `note ${tone}`, text: t });
    this.card.append(n);
    return n;
  }
  protected stats(rows: [string, string, string?][]) {
    this.card.append(
      el(
        'div',
        { class: 'stats' },
        rows.map(([k, v, tone]) =>
          el('div', { class: 'stat' }, [
            el('span', { class: 'k', text: k }),
            el('span', { class: `v ${tone ?? ''}`, text: v }),
          ]),
        ),
      ),
    );
  }
  protected actions(...buttons: HTMLElement[]) {
    this.card.append(el('div', { class: 'actions' }, buttons));
  }
}

// ---------------------------------------------------------------------------

export interface WinInfo {
  levelId: number;
  stars: number;
  imbalance: number;
  tolerance: number;
  packages: number;
  /** Help taken this shipment (refused drops are not shown: they never cost anything). */
  hints: number;
  undos: number;
  isLastLevel: boolean;
  newBest: boolean;
  firstClear: boolean;
}

/** NONE / HINT / UNDO / HINT + UNDO. */
function helpUsed(hints: number, undos: number): string {
  if (hints > 0 && undos > 0) return t('win.helpBoth');
  if (hints > 0) return t('win.helpHint');
  if (undos > 0) return t('win.helpUndo');
  return t('win.helpNone');
}

export class WinPanel extends Modal {
  constructor(
    info: WinInfo,
    actions: { onNext: () => void; onRetry: () => void; onLevels: () => void },
  ) {
    super();
    this.kicker(t('win.kicker'));
    this.headline(t('win.headline'), 'good');

    const stars = el('div', { class: 'stars' });
    for (let i = 0; i < 3; i++) {
      const earned = i < info.stars;
      const s = el('div', { class: `star ${earned ? '' : 'off'}`, html: STAR_SVG(earned) });
      stars.append(s);
      if (earned) {
        setTimeout(() => {
          if (!s.isConnected) return;
          audio.star(i);
          s.classList.add('pop');
        }, 260 + i * 220);
      }
    }
    this.card.append(stars);

    const accuracy = Math.max(0, Math.round((1 - info.imbalance / Math.max(info.tolerance, 0.001)) * 100));
    const acc = accuracy >= 80 ? 'good' : accuracy >= 55 ? 'warn' : '';
    this.stats([
      [t('win.accuracy'), `${accuracy}%`, acc],
      [t('win.finalImbalance'), fmt(info.imbalance, 2), acc],
      [t('win.stowed'), `${info.packages} / ${info.packages}`, 'good'],
      [t('win.help'), helpUsed(info.hints, info.undos), info.hints + info.undos === 0 ? 'good' : 'dim'],
    ]);

    if (info.newBest) this.note(t('win.newBest'), 'gold');
    else if (info.hints > 0) this.note(t('win.hintCap'), 'dim');
    else if (info.firstClear && !info.isLastLevel) this.note(t('win.unlocked', { n: info.levelId + 1 }), 'accent');
    if (info.isLastLevel) this.note(t('win.allCleared'), 'warm');

    const primary = btn(
      info.isLastLevel ? t('win.levelSelect') : t('win.next'),
      () => this.close(info.isLastLevel ? actions.onLevels : actions.onNext),
      'primary',
      'lg',
    );
    primary.dataset.role = 'next';
    const row = el('div', { class: 'row' }, [
      btn(t('win.retry'), () => this.close(actions.onRetry), 'secondary', 'md', 'half'),
      btn(t('win.levels'), () => this.close(actions.onLevels), 'secondary', 'md', 'half'),
    ]);
    this.actions(primary, row);
  }
}

// ---------------------------------------------------------------------------

export type FailReason = 'collapse' | 'overload' | 'fragile';

const failTitle = (r: FailReason) => t(`fail.${r}.title` as const);
const failBody = (r: FailReason) => t(`fail.${r}.body` as const);

export class FailPanel extends Modal {
  constructor(reason: FailReason, detail: string, actions: { onRetry: () => void; onLevels: () => void }) {
    super();
    this.kicker(t('fail.kicker'));
    this.headline(failTitle(reason), 'bad');
    this.body(failBody(reason));
    if (detail) this.note(detail, 'warn').dataset.role = 'fail-detail';
    const retry = btn(t('fail.retry'), () => this.close(actions.onRetry), 'primary', 'lg');
    retry.dataset.role = 'retry';
    this.actions(retry, btn(t('fail.levelSelect'), () => this.close(actions.onLevels), 'ghost', 'md'));
  }
}

// ---------------------------------------------------------------------------

export interface PauseOptions {
  soundOn: boolean;
  hapticsOn: boolean;
  onToggleSound: () => boolean;
  onToggleHaptics: () => boolean;
  onResume: () => void;
  /** Runs as the restart button is pressed, before the panel's close (onRestart runs after it). */
  onRestartPress?: () => void;
  onRestart: () => void;
  onExit: () => void;
  restartLabel: string;
  exitLabel: string;
  /** VIEW 2D | 3D and 3D QUALITY. While a switch runs, RESUME / restart / exit and the toggle are disabled. */
  view?: ViewControls;
  /** Paused because the player was away (app in the background, or a resumed save): say that nothing moved. */
  away?: boolean;
}

interface ToggleLabels {
  soundOn: string;
  soundOff: string;
  vibrationOn: string;
  vibrationOff: string;
}

const toggleLabels = (): ToggleLabels => ({
  soundOn: t('pause.soundOn'),
  soundOff: t('pause.soundOff'),
  vibrationOn: t('pause.vibrationOn'),
  vibrationOff: t('pause.vibrationOff'),
});

/** SOUND / VIBRATION on-off buttons, side by side. */
function toggleRow(
  opts: { soundOn: boolean; hapticsOn: boolean; onToggleSound: () => boolean; onToggleHaptics: () => boolean },
  labels: ToggleLabels,
) {
  const style = (on: boolean) => `btn ${on ? 'secondary' : 'ghost'} sm half`;
  const sound = btn(opts.soundOn ? labels.soundOn : labels.soundOff, () => {
    const on = opts.onToggleSound();
    sound.textContent = on ? labels.soundOn : labels.soundOff;
    sound.className = style(on);
  }, opts.soundOn ? 'secondary' : 'ghost', 'sm', 'half');
  sound.dataset.role = 'sound';
  const haptic = btn(opts.hapticsOn ? labels.vibrationOn : labels.vibrationOff, () => {
    const on = opts.onToggleHaptics();
    haptic.textContent = on ? labels.vibrationOn : labels.vibrationOff;
    haptic.className = style(on);
  }, opts.hapticsOn ? 'secondary' : 'ghost', 'sm', 'half');
  haptic.dataset.role = 'vibration';
  return el('div', { class: 'row toggles' }, [sound, haptic]);
}

export class PausePanel extends Modal {
  private locked: HTMLButtonElement[] = [];
  private awayNote: HTMLElement | null = null;
  private readonly tryResume: () => boolean;

  constructor(opts: PauseOptions) {
    super();
    this.root.classList.add('pause');
    this.headline(t('pause.title'));
    if (opts.away) this.showAway();
    const view = opts.view;
    const idle = () => !view?.busy();
    this.tryResume = () => {
      if (!idle() || !this.open) return false;
      this.close(opts.onResume);
      return true;
    };
    if (view) {
      const section = viewSection(view, { note: true });
      this.card.append(section.el);
      this.cleanups.push(section.dispose);
      this.cleanups.push(view.subscribe(() => this.setBusy(view.busy())));
    }
    const resume = btn(t('pause.resume'), () => this.tryResume(), 'primary', 'lg');
    resume.dataset.role = 'resume';
    const restart = btn(opts.restartLabel, () => {
      if (!idle() || !this.open) return;
      opts.onRestartPress?.();
      this.close(opts.onRestart);
    });
    restart.dataset.role = 'restart';
    const exit = btn(opts.exitLabel, () => idle() && this.close(opts.onExit), 'ghost');
    exit.dataset.role = 'exit';
    this.locked = [resume, restart, exit];
    for (const b of [restart, exit]) b.className = `btn ${b === exit ? 'ghost' : 'secondary'} md half`;
    this.actions(resume, toggleRow(opts, toggleLabels()), el('div', { class: 'row leave' }, [restart, exit]));
    this.setBusy(!idle());
  }

  get away(): boolean {
    return this.awayNote !== null;
  }

  /** Adds the "paused while you were away" line under the title (once). */
  showAway() {
    if (this.awayNote) return;
    const n = el('div', { class: 'note accent', text: t('pause.away') });
    n.dataset.role = 'away';
    n.setAttribute('role', 'status');
    this.card.querySelector('.headline')?.after(n);
    this.awayNote = n;
  }

  /** RESUME from outside the panel (Escape, Android back); refused while a view switch runs. */
  resume(): boolean {
    return this.tryResume();
  }

  /** While the view is being switched the player can neither resume nor leave. */
  private setBusy(busy: boolean) {
    for (const b of this.locked) b.disabled = busy;
    this.card.classList.toggle('busy', busy);
  }
}

/** The main menu's settings: view, 3D quality, motion, language, sound, vibration, tutorial. */
export class SettingsPanel extends Modal {
  constructor(opts: {
    view: ViewControls;
    soundOn: boolean;
    hapticsOn: boolean;
    onToggleSound: () => boolean;
    onToggleHaptics: () => boolean;
    onReplayTutorial: () => void;
    /** The tutorial was skipped or partly done, so there is something to replay. */
    tutorialReplayable: boolean;
    onClose: () => void;
  }) {
    super();
    this.root.classList.add('settings');
    this.headline(t('settings.title'));
    const section = viewSection(opts.view);
    this.card.append(section.el);
    this.cleanups.push(section.dispose);
    const replay = btn(t('settings.tutorial'), () => {
      opts.onReplayTutorial();
      replay.disabled = true;
    }, 'secondary', 'sm');
    replay.dataset.role = 'replay-tutorial';
    replay.disabled = !opts.tutorialReplayable;
    const done = btn(t('settings.close'), () => this.close(opts.onClose), 'primary', 'lg');
    done.dataset.role = 'close-settings';
    this.actions(toggleRow(opts, toggleLabels()), replay, done);
  }
}

// ---------------------------------------------------------------------------

const CARGO_TYPES: readonly PackageType[] = ['standard', 'heavy', 'fragile', 'long', 'priority'];

/** A yes / no question (e.g. starting fresh would end a shift in progress). */
export class ConfirmPanel extends Modal {
  constructor(opts: {
    title: string;
    body: string;
    confirm: string;
    cancel: string;
    onConfirm: () => void;
    onCancel?: () => void;
  }) {
    super();
    this.root.classList.add('confirm');
    this.headline(opts.title);
    this.body(opts.body);
    const yes = btn(opts.confirm, () => this.close(opts.onConfirm), 'danger', 'md');
    yes.dataset.role = 'confirm';
    const no = btn(opts.cancel, () => this.close(opts.onCancel), 'primary', 'lg');
    no.dataset.role = 'cancel';
    this.actions(no, yes);
  }

  /** Android back: the same as CANCEL. */
  cancel(onCancel?: () => void) {
    this.close(onCancel);
  }
}

// ---------------------------------------------------------------------------

export class LegendPanel extends Modal {
  constructor(onClose: () => void) {
    super();
    this.headline(t('guide.title'));
    this.card.append(
      el(
        'div',
        { class: 'legend' },
        CARGO_TYPES.map((type) => {
          const spec = PACKAGE_SPECS[type];
          return el('div', { class: 'row' }, [
            el('div', { class: `swatch ${type}` }, [el('b', { text: String(spec.weight) })]),
            el('div', {}, [
              el('div', {
                class: 'name',
                text: t('guide.row', { label: t(`cargo.${type}.label` as const), weight: spec.weight }),
              }),
              el('div', { class: 'desc', text: t(`cargo.${type}.note` as const) }),
            ]),
          ]);
        }),
      ),
    );
    this.card.append(el('div', { class: 'rule' }));
    this.card.append(el('h3', { class: 'accent', text: t('guide.balance') }));
    this.body(t('guide.balanceBody'));
    this.card.append(el('h3', { class: 'bad', text: t('guide.red') }));
    this.body(t('guide.redBody'));
    const ok = btn(t('guide.ok'), () => this.close(onClose), 'primary', 'lg');
    ok.dataset.role = 'close';
    this.actions(ok);
  }
}

// ---------------------------------------------------------------------------

export interface RunOverInfo {
  seed: number;
  wave: number;
  score: number;
  stowed: number;
  cleanWaves: number;
  bestScore: number;
  bestWave: number;
  newBest: boolean;
  reason: FailReason;
  /** The same fact line the campaign loss panel shows. */
  detail: string;
  /** A hint or an undo was used somewhere in the run. */
  assisted: boolean;
}

export class RunOverPanel extends Modal {
  constructor(
    info: RunOverInfo,
    actions: { onRetrySame: () => void; onNewShift: () => void; onMenu: () => void },
  ) {
    super();
    this.kicker(t('run.kicker'));
    this.headline(failTitle(info.reason), 'bad');
    if (info.detail) this.note(info.detail, 'warn').dataset.role = 'fail-detail';
    this.card.append(el('div', { class: 'big', text: formatScore(info.score) }));
    this.card.append(el('div', { class: 'note dim', text: t('run.finalScore') }));
    this.stats([
      [t('run.wavesCleared'), String(Math.max(0, info.wave - 1))],
      [t('run.stowed'), String(info.stowed)],
      [t('run.flawless'), String(info.cleanWaves), info.cleanWaves > 0 ? 'good' : ''],
      [t('run.best'), formatScore(Math.max(info.bestScore, info.score)), info.newBest ? 'gold' : 'dim'],
    ]);
    if (info.newBest) this.note(t('run.newBest'), 'gold');
    else this.note(t('run.bestWave', { n: info.bestWave }), 'dim');
    if (info.assisted) this.note(t('run.assisted'), 'dim').dataset.role = 'assisted';
    // Two different things: the same shift again (same seed, wave 1), or a fresh one.
    const same = btn(t('run.retrySame'), () => this.close(actions.onRetrySame), 'primary', 'lg');
    same.dataset.role = 'retry-same';
    const fresh = btn(t('run.newShift'), () => this.close(actions.onNewShift), 'gold', 'md');
    fresh.dataset.role = 'new-shift';
    const menu = btn(t('run.mainMenu'), () => this.close(actions.onMenu), 'ghost');
    menu.dataset.role = 'menu';
    this.actions(same, fresh, menu);
    const seed = el('div', { class: 'seed', text: t('run.shift', { seed: formatSeed(info.seed) }) });
    seed.dataset.role = 'shift-code';
    this.card.append(seed);
  }
}

// ---------------------------------------------------------------------------

/** A score line's label in the current language. Ruleset 2: 'clean' means no help was used. */
function scoreLabel(l: ScoreLine, wave: number): string {
  switch (l.key) {
    case 'cargo':
      return t('score.cargo');
    case 'shipment':
      return t('score.shipment', { n: wave });
    case 'balance':
      return t('score.balance');
    case 'perfect':
      return t('score.perfect');
    case 'clean':
      return t('score.cleanAssistFree');
  }
}

/** Non-blocking wave-clear breakdown for Endless. Auto-dismissed by the game. */
export class WaveClearCard {
  private el: HTMLElement;

  constructor(result: WaveResult, wave: number) {
    const lines = result.lines.map((l, i) =>
      el('div', { class: 'line', style: { animationDelay: `${120 + i * 90}ms` } }, [
        el('span', { class: 'k', text: scoreLabel(l, wave) }),
        el('span', { class: 'v', text: `+${l.value}` }),
      ]),
    );
    const total = el('div', {
      class: 'total',
      text: `+${result.total}`,
      style: { animationDelay: `${160 + result.lines.length * 90}ms` },
    });
    this.el = el('div', { class: 'wave-card' }, [
      el('div', { class: 't', text: t('wave.dispatched') }),
      ...lines,
      total,
    ]);
    uiRoot().append(this.el);
    requestAnimationFrame(() => this.el.classList.add('on'));
  }

  dismiss() {
    this.el.classList.add('out');
    setTimeout(() => this.el.remove(), 240);
  }
}

/**
 * A one-line suggestion with a choice, shown between shipments and never
 * blocking the game (e.g. "3D is slow here - switch to 2D?"). Any button
 * dismisses it.
 */
export class SuggestCard {
  private el: HTMLElement;
  private gone = false;

  constructor(text: string, choices: { label: string; role: string; style: BtnStyle; onPick: () => void }[]) {
    const buttons = choices.map((c) => {
      const b = btn(c.label, () => {
        this.dismiss();
        c.onPick();
      }, c.style, 'sm');
      b.dataset.role = c.role;
      return b;
    });
    this.el = el('div', { class: 'suggest', text: '' }, [
      el('div', { class: 'text', text }),
      el('div', { class: 'row' }, buttons),
    ]);
    this.el.setAttribute('role', 'dialog');
    uiRoot().append(this.el);
    requestAnimationFrame(() => this.el.classList.add('on'));
  }

  get open(): boolean {
    return !this.gone;
  }

  dismiss() {
    if (this.gone) return;
    this.gone = true;
    this.el.classList.add('out');
    setTimeout(() => this.el.remove(), 240);
  }
}

/** Coaching line shown at level start; the game dismisses it on first drag. */
export class TipCard {
  private el: HTMLElement;
  private gone = false;

  constructor(text: string, autoMs = 4600, extraClass = '') {
    this.el = el('div', { class: `tip ${extraClass}`.trim(), text });
    uiRoot().append(this.el);
    setTimeout(() => this.dismiss(), autoMs);
  }

  dismiss() {
    if (this.gone) return;
    this.gone = true;
    this.el.classList.add('out');
    setTimeout(() => this.el.remove(), 440);
  }
}
