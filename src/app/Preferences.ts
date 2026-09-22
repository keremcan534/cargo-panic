/**
 * Player preferences that follow the device unless the player picks one:
 * reduced motion (the system `prefers-reduced-motion` setting) and the
 * language (the device's language list). The save stores `null` for
 * "follow the device"; these helpers turn that into the value in force and
 * apply it to the document. The App pushes changes to the live stage and the
 * current screen.
 */

import { progress } from '../game/systems/ProgressManager';
import { detectLanguage, setLanguage } from '../i18n';
import type { Lang } from '../i18n';

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function systemReducedMotion(): boolean {
  try {
    return window.matchMedia(MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/** The saved choice, or the system setting when there is none. */
export function effectiveReducedMotion(): boolean {
  return progress.settings.reducedMotion ?? systemReducedMotion();
}

/** `reduced-motion` on <html> gates the CSS animations (see style.css). */
export function applyMotionClass(on: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('reduced-motion', on);
}

/** Calls `fn` when the system reduced-motion setting changes. Returns the unsubscribe function. */
export function onSystemMotionChange(fn: () => void): () => void {
  try {
    const mq = window.matchMedia(MOTION_QUERY);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  } catch {
    return () => undefined;
  }
}

/** The saved language, or the device's (Turkish for a Turkish device, English otherwise). */
export function effectiveLanguage(): Lang {
  const saved = progress.settings.language;
  if (saved) return saved;
  return detectLanguage(typeof navigator !== 'undefined' ? navigator.languages : undefined);
}

/** Puts the language in force into the text dictionary and <html lang>. */
export function applyLanguage(): Lang {
  const lang = effectiveLanguage();
  setLanguage(lang);
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  return lang;
}
