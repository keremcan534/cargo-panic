/**
 * The settings rows shared by the pause panel and the main menu's settings
 * panel: VIEW (2D | 3D), 3D QUALITY (AUTO | LOW | HIGH), REDUCED MOTION
 * (SYSTEM | ON | OFF) and LANGUAGE (a button naming the language in force
 * that opens the list: SYSTEM and every language, each named in itself).
 *
 * The section shows the renderer actually drawing (which can be 2D while the
 * stored preference is 3D, when 3D could not start), hides the quality row
 * in 2D, and disables the view rows while a switch is running. Picking a
 * view goes through App.switchRenderMode and is stored as the player's
 * preference; motion and language go through the App too and apply at once.
 */

import type { AppContext } from '../app/Router';
import type { HostEvent } from '../app/StageHost';
import type { LanguagePref } from '../game/save/schema';
import { progress } from '../game/systems/ProgressManager';
import { LANGUAGES as LANGUAGE_CODES, LANGUAGE_NAMES, t } from '../i18n';
import type { TextKey } from '../i18n';
import type { RenderMode } from '../render/GameView';
import type { QualityPref } from '../render/Stage';
import { el } from './dom';
import { audio } from '../game/systems/AudioManager';
import { haptics } from '../game/systems/Haptics';

export interface ViewControls {
  /** Renderer drawing now. */
  mode(): RenderMode;
  quality(): QualityPref;
  /** A view switch is running. */
  busy(): boolean;
  pickView(mode: RenderMode): void;
  pickQuality(q: QualityPref): void;
  /** Saved reduced-motion choice: null follows the system. */
  motion(): boolean | null;
  pickMotion(on: boolean | null): void;
  /** Saved language: null follows the device. */
  language(): LanguagePref | null;
  pickLanguage(lang: LanguagePref | null): void;
  /** Called on every host change (busy, switched); returns the unsubscribe function. */
  subscribe(cb: (e: HostEvent) => void): () => void;
}

export function viewControls(ctx: AppContext): ViewControls {
  return {
    mode: () => ctx.host.mode,
    quality: () => progress.settings.quality,
    busy: () => ctx.host.busy,
    pickView: (mode) => void ctx.app.switchRenderMode(mode, { persist: true }),
    pickQuality: (q) => ctx.app.setQuality(q),
    motion: () => progress.settings.reducedMotion,
    pickMotion: (on) => ctx.app.setReducedMotion(on),
    language: () => progress.settings.language,
    pickLanguage: (lang) => ctx.app.setLanguage(lang),
    subscribe: (cb) => ctx.host.onEvent(cb),
  };
}

interface Option<T extends string> {
  value: T;
  label: TextKey;
}

type MotionValue = 'system' | 'on' | 'off';
type LanguageValue = 'system' | LanguagePref;

const MOTIONS: Option<MotionValue>[] = [
  { value: 'system', label: 'settings.motionSystem' },
  { value: 'on', label: 'settings.on' },
  { value: 'off', label: 'settings.off' },
];

const motionValue = (v: boolean | null): MotionValue => (v === null ? 'system' : v ? 'on' : 'off');
const motionPref = (v: MotionValue): boolean | null => (v === 'system' ? null : v === 'on');

const VIEWS: Option<RenderMode>[] = [
  { value: '2d', label: 'settings.view2d' },
  { value: '3d', label: 'settings.view3d' },
];

const QUALITIES: Option<QualityPref>[] = [
  { value: 'auto', label: 'settings.qualityAuto' },
  { value: 'low', label: 'settings.qualityLow' },
  { value: 'high', label: 'settings.qualityHigh' },
];

/** A one-of-N button row. Buttons carry data-value; the chosen one has aria-checked="true". */
function segmented<T extends string>(role: string, options: Option<T>[], onPick: (v: T) => void) {
  const buttons = options.map((o) => {
    const b = el('button', { class: 'seg-btn', text: t(o.label) });
    b.type = 'button';
    b.dataset.value = o.value;
    b.setAttribute('role', 'radio');
    b.addEventListener('pointerdown', () => audio.unlock());
    b.addEventListener('click', () => {
      if (b.disabled || b.getAttribute('aria-checked') === 'true') return;
      audio.click();
      haptics.tap();
      onPick(o.value);
    });
    return b;
  });
  const row = el('div', { class: 'seg' }, buttons);
  row.dataset.role = role;
  row.setAttribute('role', 'radiogroup');
  return {
    row,
    set(value: T, disabled: boolean) {
      for (const b of buttons) {
        const on = b.dataset.value === value;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
        b.disabled = disabled;
      }
    },
  };
}

/**
 * LANGUAGE: a button naming the choice in force (aria-expanded) that opens a
 * list right under its row - SYSTEM, then every language written in itself
 * (and marked with its own lang, so it is read and hyphenated as such). The
 * list is a radio group: arrow keys move between options, Enter / Space
 * picks, Escape closes it without leaving the panel. A pick closes the list
 * and applies at once (the screen may re-render in the new language).
 */
function languagePicker(onPick: (v: LanguageValue) => void) {
  const values: LanguageValue[] = ['system', ...LANGUAGE_CODES];
  const nameOf = (v: LanguageValue) => (v === 'system' ? t('settings.languageSystem') : LANGUAGE_NAMES[v]);
  const listId = `lang-list-${Math.random().toString(36).slice(2, 8)}`;

  const current = el('span', { class: 'lang-name' });
  const chevron = el('span', { class: 'lang-chevron', html: '<svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5 6 6.5 11 1.5"/></svg>' });
  const toggle = el('button', { class: 'lang-btn' }, [current, chevron]);
  toggle.type = 'button';
  toggle.dataset.role = 'language-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', listId);
  toggle.setAttribute('aria-haspopup', 'true');

  const options = values.map((v) => {
    const b = el('button', { class: 'lang-opt', text: nameOf(v) });
    b.type = 'button';
    b.dataset.value = v;
    b.setAttribute('role', 'radio');
    if (v !== 'system') b.lang = v;
    b.addEventListener('pointerdown', () => audio.unlock());
    b.addEventListener('click', () => {
      setOpen(false);
      if (b.getAttribute('aria-checked') === 'true') return;
      audio.click();
      haptics.tap();
      onPick(v);
    });
    return b;
  });
  const list = el('div', { class: 'lang-list', id: listId }, options);
  list.dataset.role = 'language';
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', t('settings.language'));
  list.hidden = true;

  function setOpen(open: boolean, focus = true) {
    if (list.hidden === !open) return;
    list.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      const on = options.find((o) => o.getAttribute('aria-checked') === 'true') ?? options[0];
      if (focus) on.focus({ preventScroll: true });
      list.scrollIntoView?.({ block: 'nearest' });
    } else if (focus && list.contains(document.activeElement)) {
      toggle.focus({ preventScroll: true });
    }
  }

  toggle.addEventListener('pointerdown', () => audio.unlock());
  toggle.addEventListener('click', () => {
    audio.click();
    setOpen(list.hidden);
  });
  // Escape closes the list only: stopped here, it never reaches the game's back handling.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !list.hidden) {
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
      return;
    }
    const i = options.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : step ? (i + step + options.length) % options.length : -1;
    if (to < 0) return;
    e.preventDefault();
    options[to].focus();
  };
  list.addEventListener('keydown', onKey);
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !list.hidden) {
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
    }
  });

  return {
    toggle,
    list,
    set(value: LanguageValue) {
      current.textContent = nameOf(value);
      toggle.setAttribute('aria-label', `${t('settings.language')}: ${nameOf(value)}`);
      current.lang = value === 'system' ? '' : value;
      for (const o of options) {
        const on = o.dataset.value === value;
        o.classList.toggle('on', on);
        o.setAttribute('aria-checked', String(on));
        o.tabIndex = on ? 0 : -1;
      }
    },
  };
}

export interface ViewSection {
  readonly el: HTMLElement;
  /** Re-reads mode, quality and busy (called on every host event too). */
  refresh(): void;
  dispose(): void;
}

export function viewSection(c: ViewControls, opts: { note?: boolean } = {}): ViewSection {
  const view = segmented('view', VIEWS, (m) => {
    c.pickView(m);
    refresh();
  });
  const quality = segmented('quality', QUALITIES, (q) => {
    c.pickQuality(q);
    refresh();
  });
  view.row.setAttribute('aria-label', t('settings.view'));
  quality.row.setAttribute('aria-label', t('settings.quality'));
  const motion = segmented('motion', MOTIONS, (v) => {
    c.pickMotion(motionPref(v));
    refresh();
  });
  const language = languagePicker((v) => {
    // May re-render the whole screen in the new language (this section included).
    c.pickLanguage(v === 'system' ? null : v);
    refresh();
  });
  motion.row.setAttribute('aria-label', t('settings.motion'));
  const row = (label: string, control: HTMLElement, extra = '') =>
    el('div', { class: `setting ${extra}`.trim() }, [el('div', { class: 'label', text: label }), control]);
  const qualityRow = row(t('settings.quality'), quality.row);
  const root = el('div', { class: 'view-settings' }, [
    row(t('settings.view'), view.row),
    qualityRow,
    opts.note ? el('div', { class: 'setting-note', text: t('settings.viewNote') }) : null,
    row(t('settings.motion'), motion.row),
    row(t('settings.language'), language.toggle, 'language'),
    language.list,
  ]);

  function refresh() {
    const busy = c.busy();
    const mode = c.mode();
    view.set(mode, busy);
    quality.set(c.quality(), busy);
    motion.set(motionValue(c.motion()), false);
    language.set(c.language() ?? 'system');
    qualityRow.hidden = mode !== '3d';
    root.classList.toggle('busy', busy);
  }
  refresh();
  const off = c.subscribe(() => refresh());
  return { el: root, refresh, dispose: off };
}
