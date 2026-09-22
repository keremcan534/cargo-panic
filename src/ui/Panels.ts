/**
 * Modal overlays: level cleared, level failed, pause, settings, cargo guide,
 * run over - plus the non-blocking wave-clear, coaching and suggestion
 * cards. All DOM.
 */

import { PACKAGE_SPECS } from '../game/levels/types';
import type { PackageType } from '../game/levels/types';
import { audio } from '../game/systems/AudioManager';
import { formatScore, formatSeed } from '../game/systems/RunManager';
import type { WaveResult } from '../game/systems/RunManager';
import { t } from '../i18n';
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
    this.card.append(el('div', { class: `note ${tone}`, text: t }));
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
  mistakes: number;
  hintUsed: boolean;
  isLastLevel: boolean;
  newBest: boolean;
  firstClear: boolean;
}

export class WinPanel extends Modal {
  constructor(
    info: WinInfo,
    actions: { onNext: () => void; onRetry: () => void; onLevels: () => void },
  ) {
    super();
    this.kicker('WAREHOUSE');
    this.headline('SECURED', 'good');

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
      ['BALANCE ACCURACY', `${accuracy}%`, acc],
      ['FINAL IMBALANCE', info.imbalance.toFixed(2), acc],
      ['PACKAGES STOWED', `${info.packages} / ${info.packages}`, 'good'],
      ['REJECTED DROPS', String(info.mistakes), info.mistakes === 0 ? 'good' : 'warn'],
    ]);

    if (info.newBest) this.note('NEW PERSONAL BEST', 'gold');
    else if (info.hintUsed) this.note('HINT USED - MAX 2 STARS', 'dim');
    else if (info.firstClear && !info.isLastLevel) this.note(`LEVEL ${info.levelId + 1} UNLOCKED`, 'accent');
    if (info.isLastLevel) this.note('ALL 25 LEVELS CLEARED', 'warm');

    const primary = btn(
      info.isLastLevel ? 'LEVEL SELECT' : 'NEXT LEVEL',
      () => this.close(info.isLastLevel ? actions.onLevels : actions.onNext),
      'primary',
      'lg',
    );
    primary.dataset.role = 'next';
    const row = el('div', { class: 'row' }, [
      btn('RETRY', () => this.close(actions.onRetry), 'secondary', 'md', 'half'),
      btn('LEVELS', () => this.close(actions.onLevels), 'secondary', 'md', 'half'),
    ]);
    this.actions(primary, row);
  }
}

// ---------------------------------------------------------------------------

export type FailReason = 'collapse' | 'overload' | 'fragile';

const FAIL_COPY: Record<FailReason, { title: string; body: string }> = {
  collapse: {
    title: 'RACK COLLAPSED',
    body: 'Left and right torque drifted too far apart. Spread the weight evenly - and remember the upper tiers count for more.',
  },
  overload: {
    title: 'SHELF OVERLOADED',
    body: 'A shelf held more weight than its load rating. Watch the bar under each plank and move cargo down a tier.',
  },
  fragile: {
    title: 'FRAGILE CARGO DAMAGED',
    body: 'Heavy cargo sat in the column directly above a fragile crate. Keep those marked columns clear.',
  },
};

export class FailPanel extends Modal {
  constructor(reason: FailReason, detail: string, actions: { onRetry: () => void; onLevels: () => void }) {
    super();
    const copy = FAIL_COPY[reason];
    this.kicker('SHIPMENT LOST');
    this.headline(copy.title, 'bad');
    this.body(copy.body);
    if (detail) this.note(detail, 'warn');
    const retry = btn('RETRY', () => this.close(actions.onRetry), 'primary', 'lg');
    retry.dataset.role = 'retry';
    this.actions(retry, btn('LEVEL SELECT', () => this.close(actions.onLevels), 'ghost', 'md'));
  }
}

// ---------------------------------------------------------------------------

export interface PauseOptions {
  soundOn: boolean;
  hapticsOn: boolean;
  onToggleSound: () => boolean;
  onToggleHaptics: () => boolean;
  onResume: () => void;
  onRestart: () => void;
  onExit: () => void;
  restartLabel: string;
  exitLabel: string;
  /** VIEW 2D | 3D and 3D QUALITY. While a switch runs, RESUME / restart / exit and the toggle are disabled. */
  view?: ViewControls;
}

interface ToggleLabels {
  soundOn: string;
  soundOff: string;
  vibrationOn: string;
  vibrationOff: string;
}

/** The pause panel's existing copy (A3 moves it to the text dictionary). */
const PAUSE_TOGGLES: ToggleLabels = {
  soundOn: 'SOUND: ON',
  soundOff: 'SOUND: OFF',
  vibrationOn: 'VIBRATION: ON',
  vibrationOff: 'VIBRATION: OFF',
};

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

  constructor(opts: PauseOptions) {
    super();
    this.root.classList.add('pause');
    this.headline('PAUSED');
    const view = opts.view;
    const idle = () => !view?.busy();
    if (view) {
      const section = viewSection(view, { note: true });
      this.card.append(section.el);
      this.cleanups.push(section.dispose);
      this.cleanups.push(view.subscribe(() => this.setBusy(view.busy())));
    }
    const resume = btn('RESUME', () => idle() && this.close(opts.onResume), 'primary', 'lg');
    resume.dataset.role = 'resume';
    const restart = btn(opts.restartLabel, () => idle() && this.close(opts.onRestart));
    restart.dataset.role = 'restart';
    const exit = btn(opts.exitLabel, () => idle() && this.close(opts.onExit), 'ghost');
    exit.dataset.role = 'exit';
    this.locked = [resume, restart, exit];
    this.actions(resume, toggleRow(opts, PAUSE_TOGGLES), restart, exit);
    this.setBusy(!idle());
  }

  /** While the view is being switched the player can neither resume nor leave. */
  private setBusy(busy: boolean) {
    for (const b of this.locked) b.disabled = busy;
    this.card.classList.toggle('busy', busy);
  }
}

/** The main menu's settings: view, 3D quality, sound and vibration. */
export class SettingsPanel extends Modal {
  constructor(opts: {
    view: ViewControls;
    soundOn: boolean;
    hapticsOn: boolean;
    onToggleSound: () => boolean;
    onToggleHaptics: () => boolean;
    onClose: () => void;
  }) {
    super();
    this.root.classList.add('settings');
    this.headline(t('settings.title'));
    const section = viewSection(opts.view);
    this.card.append(section.el);
    this.cleanups.push(section.dispose);
    const done = btn(t('settings.close'), () => this.close(opts.onClose), 'primary', 'lg');
    done.dataset.role = 'close-settings';
    this.actions(
      toggleRow(opts, {
        soundOn: t('pause.soundOn'),
        soundOff: t('pause.soundOff'),
        vibrationOn: t('pause.vibrationOn'),
        vibrationOff: t('pause.vibrationOff'),
      }),
      done,
    );
  }
}

// ---------------------------------------------------------------------------

export class LegendPanel extends Modal {
  constructor(onClose: () => void) {
    super();
    this.headline('CARGO GUIDE');
    const rows: [PackageType, string][] = [
      ['standard', 'Ordinary carton.'],
      ['heavy', 'Crushes fragile cargo below it.'],
      ['fragile', 'Keep the column above it clear.'],
      ['long', 'Eats three slots.'],
      ['priority', 'Must finish inside a gold zone.'],
    ];
    this.card.append(
      el(
        'div',
        { class: 'legend' },
        rows.map(([type, note]) => {
          const spec = PACKAGE_SPECS[type];
          return el('div', { class: 'row' }, [
            el('div', { class: `swatch ${type}` }, [el('b', { text: String(spec.weight) })]),
            el('div', {}, [
              el('div', { class: 'name', text: `${spec.label}   WEIGHT ${spec.weight}` }),
              el('div', { class: 'desc', text: note }),
            ]),
          ]);
        }),
      ),
    );
    this.card.append(el('div', { class: 'rule' }));
    this.card.append(el('h3', { class: 'accent', text: 'BALANCE' }));
    this.body(
      'Torque = weight x distance from the middle x the tier multiplier shown under each shelf. Higher shelves push harder.',
    );
    this.card.append(el('h3', { class: 'bad', text: 'WHEN THE RACK GOES RED' }));
    this.body(
      'Too much imbalance, an overloaded shelf, or a crushed fragile crate gives you a few seconds to fix it before the level fails.',
    );
    const ok = btn('GOT IT', () => this.close(onClose), 'primary', 'lg');
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
}

export class RunOverPanel extends Modal {
  constructor(info: RunOverInfo, actions: { onRetry: () => void; onMenu: () => void }) {
    super();
    this.kicker('RUN OVER');
    this.headline(FAIL_COPY[info.reason].title, 'bad');
    this.card.append(el('div', { class: 'big', text: formatScore(info.score) }));
    this.card.append(el('div', { class: 'note dim', text: 'FINAL SCORE' }));
    this.stats([
      ['WAVES CLEARED', String(Math.max(0, info.wave - 1))],
      ['PACKAGES STOWED', String(info.stowed)],
      ['FLAWLESS WAVES', String(info.cleanWaves), info.cleanWaves > 0 ? 'good' : ''],
      ['BEST SCORE', formatScore(Math.max(info.bestScore, info.score)), info.newBest ? 'gold' : 'dim'],
    ]);
    if (info.newBest) this.note('NEW PERSONAL BEST', 'gold');
    else this.note(`Best run reached wave ${info.bestWave}`, 'dim');
    const again = btn('RUN AGAIN', () => this.close(actions.onRetry), 'primary', 'lg');
    again.dataset.role = 'retry';
    this.actions(again, btn('MAIN MENU', () => this.close(actions.onMenu), 'ghost'));
    this.card.append(el('div', { class: 'seed', text: `SHIFT ${formatSeed(info.seed)}` }));
  }
}

// ---------------------------------------------------------------------------

/** Non-blocking wave-clear breakdown for Endless. Auto-dismissed by the game. */
export class WaveClearCard {
  private el: HTMLElement;

  constructor(result: WaveResult) {
    const lines = result.lines.map((l, i) =>
      el('div', { class: 'line', style: { animationDelay: `${120 + i * 90}ms` } }, [
        el('span', { class: 'k', text: l.label }),
        el('span', { class: 'v', text: `+${l.value}` }),
      ]),
    );
    const total = el('div', {
      class: 'total',
      text: `+${result.total}`,
      style: { animationDelay: `${160 + result.lines.length * 90}ms` },
    });
    this.el = el('div', { class: 'wave-card' }, [
      el('div', { class: 't', text: 'SHIPMENT DISPATCHED' }),
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

  constructor(text: string, autoMs = 4600) {
    this.el = el('div', { class: 'tip', text });
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
