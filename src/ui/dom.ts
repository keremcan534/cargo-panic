/**
 * Tiny DOM helpers. All UI is plain HTML over the WebGL canvas: crisp text at
 * any pixel ratio, native touch targets, and CSS for the transitions.
 */

import { audio } from '../game/systems/AudioManager';
import { haptics } from '../game/systems/Haptics';

export const uiRoot = (): HTMLElement => document.getElementById('ui-root') as HTMLElement;

export interface ElOpts {
  class?: string;
  text?: string;
  html?: string;
  id?: string;
  style?: Partial<CSSStyleDeclaration>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOpts = {},
  children: (HTMLElement | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (opts.class) e.className = opts.class;
  if (opts.id) e.id = opts.id;
  if (opts.text !== undefined) e.textContent = opts.text;
  if (opts.html !== undefined) e.innerHTML = opts.html;
  if (opts.style) Object.assign(e.style, opts.style);
  for (const c of children) {
    if (c === null || c === undefined) continue;
    e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

export type BtnStyle = 'primary' | 'gold' | 'secondary' | 'ghost' | 'danger';
export type BtnSize = 'lg' | 'md' | 'sm';

export function btn(
  label: string,
  onClick: () => void,
  style: BtnStyle = 'secondary',
  size: BtnSize = 'md',
  extra = '',
): HTMLButtonElement {
  const b = el('button', { class: `btn ${style} ${size} ${extra}`.trim(), text: label });
  b.type = 'button';
  b.addEventListener('pointerdown', () => audio.unlock());
  b.addEventListener('click', () => {
    audio.click();
    haptics.tap();
    onClick();
  });
  return b;
}

export type IconKind = 'pause' | 'restart' | 'back' | 'help' | 'sound-on' | 'sound-off' | 'gear';

const ICONS: Record<IconKind, string> = {
  pause: '<rect class="fill" x="6" y="4" width="4" height="16" rx="1"/><rect class="fill" x="14" y="4" width="4" height="16" rx="1"/>',
  restart: '<path d="M19 12a7 7 0 1 1-2.2-5.1"/><path class="fill" d="M20 3v6h-6z"/>',
  back: '<path d="M14 5l-7 7 7 7"/>',
  help: '<path d="M8.5 9.5a3.5 3.5 0 1 1 5 3.2c-1 .6-1.5 1.2-1.5 2.3"/><circle class="fill" cx="12" cy="19" r="1.4"/>',
  'sound-on': '<path class="fill" d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/>',
  'sound-off': '<path class="fill" d="M4 9h4l5-4v14l-5-4H4z"/><path class="bad" d="M16 9l5 6M21 9l-5 6"/>',
  gear: '<circle cx="12" cy="12" r="6.2"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2.6v3.2M12 18.2v3.2M21.4 12h-3.2M5.8 12H2.6M18.6 5.4l-2.3 2.3M7.7 16.3l-2.3 2.3M18.6 18.6l-2.3-2.3M7.7 7.7 5.4 5.4"/>',
};

export function iconBtn(kind: IconKind, onClick: () => void, title: string = kind): HTMLButtonElement {
  const b = el('button', { class: 'icon-btn' });
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.dataset.icon = kind;
  b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[kind]}</svg>`;
  b.addEventListener('pointerdown', () => audio.unlock());
  b.addEventListener('click', () => {
    audio.click();
    haptics.tap();
    onClick();
  });
  return b;
}

export function setIcon(b: HTMLButtonElement, kind: IconKind) {
  b.dataset.icon = kind;
  b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[kind]}</svg>`;
}

export const STAR_SVG = (on: boolean) =>
  `<svg viewBox="0 0 64 64"><path d="M32 6l7.6 16.6 18.2 2-13.5 12.3 3.6 17.9L32 45.7 16.1 54.8l3.6-17.9L6.2 24.6l18.2-2z" fill="${on ? '#ffc93c' : '#2b3444'}" stroke="${on ? '#8a5f00' : '#3d4a5c'}" stroke-width="3" stroke-linejoin="round"/></svg>`;

/** Fade the whole screen to the background colour and back. */
export function fadeOut(ms = 200): Promise<void> {
  const f = document.getElementById('fade') as HTMLElement;
  f.classList.add('on');
  return new Promise((r) => setTimeout(r, ms));
}

export function fadeIn() {
  const f = document.getElementById('fade') as HTMLElement;
  requestAnimationFrame(() => f.classList.remove('on'));
}
