/**
 * The title screen's free band for the backdrop's hero rack (render/hero.ts
 * HeroBand): from the bottom of the tagline to the top of the button column,
 * in CSS px from the top of the menu root - which covers the same box as the
 * stage canvas (both fill #app).
 *
 * Measured when the menu is built and then only when something changes size
 * - the viewport, the tagline wrapping onto another line, the button column
 * growing (CONTINUE, a save warning) - through a ResizeObserver; never per
 * frame. Layout offsets are read, not bounding boxes, so the wordmark's bob
 * (a transform) does not move the band.
 */

import type { HeroBand } from '../render/hero';
import { sameBand } from '../render/hero';

/** Top of `el` in `root`'s coordinates, ignoring transforms. */
function topIn(el: HTMLElement, root: HTMLElement): number {
  let y = 0;
  for (let n: HTMLElement | null = el; n && n !== root; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
  return y;
}

/**
 * Calls `onChange` with the band now, then whenever it changes. Returns the
 * function that stops watching.
 */
export function watchHeroBand(
  root: HTMLElement,
  tagline: HTMLElement,
  buttons: HTMLElement,
  onChange: (band: HeroBand) => void,
): () => void {
  let last: HeroBand | null = null;
  const measure = () => {
    const band = { top: topIn(tagline, root) + tagline.offsetHeight, bottom: topIn(buttons, root) };
    if (sameBand(band, last)) return;
    last = band;
    onChange(band);
  };
  measure();
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }
  const observer = new ResizeObserver(measure);
  for (const e of [root, tagline, buttons]) observer.observe(e);
  return () => observer.disconnect();
}
