/**
 * A short, non-blocking notice card (e.g. "3D could not start, the game is
 * in 2D"). It lives outside #ui-root so a screen change does not wipe it,
 * takes no input at all (taps go through to whatever is under it), and
 * leaves by itself after a few seconds.
 */

export interface NoticeHandle {
  dismiss(): void;
}

const live = new Map<string, NoticeHandle>();

/** Shows `text` (once: the same text already on screen is not stacked). */
export function showNotice(text: string, ms = 6500): NoticeHandle {
  const existing = live.get(text);
  if (existing) return existing;
  const host = document.getElementById('app') ?? document.body;
  const card = document.createElement('div');
  card.className = 'notice';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.textContent = text;
  host.append(card);
  requestAnimationFrame(() => card.classList.add('on'));

  let gone = false;
  const handle: NoticeHandle = {
    dismiss() {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      live.delete(text);
      card.classList.remove('on');
      card.classList.add('out');
      setTimeout(() => card.remove(), 260);
    },
  };
  const timer = window.setTimeout(() => handle.dismiss(), ms);
  live.set(text, handle);
  return handle;
}
