/**
 * Turkish/English text lookup.
 *
 * `t('key', { n: 3 })` returns the current language's copy with `{n}` filled.
 * Numbers passed as params are formatted for the language (3.5 / 3,5).
 * Pure module: the language is set by the app from the save or the device.
 */

import { en } from './en';
import type { TextKey } from './en';
import { tr } from './tr';

export type Lang = 'en' | 'tr';
export type { TextKey };

const DICTS: Record<Lang, Record<TextKey, string>> = { en, tr };

let current: Lang = 'en';
const listeners = new Set<(l: Lang) => void>();

export function getLanguage(): Lang {
  return current;
}

export function setLanguage(lang: Lang) {
  if (lang === current) return;
  current = lang;
  for (const fn of listeners) fn(lang);
}

export function onLanguageChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Turkish for a Turkish device locale, English otherwise. */
export function detectLanguage(locales: readonly string[] | string | undefined): Lang {
  const list = typeof locales === 'string' ? [locales] : (locales ?? []);
  for (const l of list) {
    const base = l.toLowerCase().split(/[-_]/)[0];
    if (base === 'tr') return 'tr';
    if (base === 'en') return 'en';
  }
  return 'en';
}

export type TextParams = Record<string, string | number>;

/** Fixed-decimal number in the current language's style. */
export function fmt(n: number, digits = 1): string {
  const s = n.toFixed(digits);
  return current === 'tr' ? s.replace('.', ',') : s;
}

export function t(key: TextKey, params?: TextParams): string {
  const raw = DICTS[current][key] ?? en[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    if (v === undefined) return m;
    return typeof v === 'number' && !Number.isInteger(v) ? fmt(v) : String(v);
  });
}

/** Copy for a campaign level, falling back to the level data itself. */
export function levelText(id: number, field: 'name' | 'objective' | 'tip', fallback: string): string {
  const key = `level.${id}.${field}` as TextKey;
  return key in en ? t(key) : fallback;
}
