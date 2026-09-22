/**
 * The VIEW (2D | 3D) and 3D QUALITY (AUTO | LOW | HIGH) controls, shared by
 * the pause panel and the main menu's settings panel.
 *
 * The section shows the renderer actually drawing (which can be 2D while the
 * stored preference is 3D, when 3D could not start), hides the quality row
 * in 2D, and disables itself while a switch is running. Picking a view goes
 * through App.switchRenderMode and is stored as the player's preference.
 */

import type { AppContext } from '../app/Router';
import type { HostEvent } from '../app/StageHost';
import { progress } from '../game/systems/ProgressManager';
import { t } from '../i18n';
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
    subscribe: (cb) => ctx.host.onEvent(cb),
  };
}

interface Option<T extends string> {
  value: T;
  label: TextKey;
}

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
  const qualityRow = el('div', { class: 'setting' }, [el('div', { class: 'label', text: t('settings.quality') }), quality.row]);
  const root = el('div', { class: 'view-settings' }, [
    el('div', { class: 'setting' }, [el('div', { class: 'label', text: t('settings.view') }), view.row]),
    qualityRow,
    opts.note ? el('div', { class: 'setting-note', text: t('settings.viewNote') }) : null,
  ]);

  function refresh() {
    const busy = c.busy();
    const mode = c.mode();
    view.set(mode, busy);
    quality.set(c.quality(), busy);
    qualityRow.hidden = mode !== '3d';
    root.classList.toggle('busy', busy);
  }
  refresh();
  const off = c.subscribe(() => refresh());
  return { el: root, refresh, dispose: off };
}
