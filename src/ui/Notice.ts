/**
 * A short, non-blocking notice card (e.g. "3D could not start, the game is
 * in 2D"). It lives outside #ui-root so a screen change does not wipe it,
 * never takes input from the game (only the card itself is tappable, to
 * dismiss it), and leaves by itself after a few seconds.
 */

export interface NoticeHandle {
  dismiss(): void;
}

const live = new Map<string, NoticeHandle>();

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
  card.addEventListener('pointerdown', () => handle.dismiss());
  live.set(text, handle);
  return handle;
}
