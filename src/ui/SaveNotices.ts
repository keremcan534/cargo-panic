/**
 * What the player is told about their save (SaveStore notices), never
 * silently:
 *
 * - At boot, every notice raised while loading (restored from the backup or
 *   the old save, unreadable and put aside, a newer version's save, no
 *   storage, an unfinished game that could not be restored) is a small card
 *   with OK, one after another.
 * - "Progress cannot be saved right now" is a banner that stays while writes
 *   fail and goes as soon as a later write works. It takes no input.
 * - While progress is only kept in memory (a newer version's save, or no
 *   storage) the main menu also carries a line saying so (storageWarning).
 *
 * The cards and the banner live outside #ui-root, so a screen change never
 * removes them.
 */

import type { SaveNotice } from '../game/save/SaveStore';
import { progress } from '../game/systems/ProgressManager';
import { onLanguageChange, t } from '../i18n';
import type { TextKey } from '../i18n';
import { btn, el } from './dom';

const host = () => document.getElementById('app') ?? document.body;

const noticeText = (n: SaveNotice) => t(`save.${n}` as TextKey);

// --- cards with OK ------------------------------------------------------------

const queue: { text: string; role: string }[] = [];
/** The card on screen, or null. */
let current: HTMLElement | null = null;

/** A small blocking card with `text` and OK. Several wait their turn. */
export function showSaveMessage(text: string, role = 'save-message') {
  queue.push({ text, role });
  if (!current) showNext();
}

/** Android back: the same as OK on the card on screen. False when there is none. */
export function closeSaveMessage(): boolean {
  if (!current) return false;
  current.remove();
  showNext();
  return true;
}

function showNext() {
  current = null;
  const item = queue.shift();
  if (!item) return;
  const ok = btn(t('save.ok'), () => current === root && closeSaveMessage(), 'primary', 'md');
  ok.dataset.role = 'save-ok';
  const card = el('div', { class: 'card' }, [
    el('div', { class: 'body', text: item.text }),
    el('div', { class: 'actions' }, [ok]),
  ]);
  const root = el('div', { class: 'modal save-modal on' }, [card]);
  root.dataset.role = item.role;
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', item.text);
  host().append(root);
  current = root;
  ok.focus();
}

/** The notices raised while the save was loaded (progress.takeSaveNotices()), once each. */
export function showBootNotices(notices: SaveNotice[]) {
  for (const n of new Set(notices)) {
    if (n === 'write-failed') setBanner(true);
    else showSaveMessage(noticeText(n), `save-${n}`);
  }
}

// --- the "cannot save" banner --------------------------------------------------

let banner: HTMLElement | null = null;

function setBanner(on: boolean) {
  if (on === (banner !== null)) return;
  if (!on) {
    banner?.remove();
    banner = null;
    return;
  }
  banner = el('div', { class: 'save-banner', text: t('save.write-failed') });
  banner.dataset.role = 'save-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  host().append(banner);
}

/**
 * From now on: a failing write shows the banner until a later write works;
 * any other notice raised after boot is a card. Returns the unsubscribe.
 */
export function watchSaveHealth(): () => void {
  const offs = [
    progress.onSaveNotice((n) => {
      progress.takeSaveNotices(); // handled here; nothing waits for the boot queue any more
      if (n === 'write-failed') setBanner(true);
      else showSaveMessage(noticeText(n), `save-${n}`);
    }),
    progress.onSaveStatus((s) => setBanner(s.writeFailed)),
    onLanguageChange(() => {
      if (banner) banner.textContent = t('save.write-failed');
    }),
  ];
  setBanner(progress.saveStatus.writeFailed);
  return () => {
    for (const off of offs) off();
  };
}

// --- main menu line ------------------------------------------------------------

/** A line for the main menu while progress is only kept in memory, or null. */
export function storageWarning(): HTMLElement | null {
  const source = progress.saveStatus.source;
  if (source !== 'newer-version' && source !== 'no-storage') return null;
  const line = el('div', { class: 'save-warning', text: noticeText(source) });
  line.dataset.role = 'save-warning';
  line.setAttribute('role', 'status');
  return line;
}
