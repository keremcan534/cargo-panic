/**
 * UI text lookup for every language in ./languages.
 *
 * `t('key', { n: 3 })` returns the current language's copy with `{n}` filled.
 * Numbers passed as params are formatted for the language's locale (3.5 / 3,5).
 * Pure module: the language is set by the app from the save or the device.
 */

import { de } from './de';
import { en } from './en';
import type { TextKey } from './en';
import { es } from './es';
import { fr } from './fr';
import { id } from './id';
import { it } from './it';
import { LANGUAGE_LOCALES } from './languages';
import type { Lang } from './languages';
import { pl } from './pl';
import { pt } from './pt';
import { ru } from './ru';
import { tr } from './tr';

export type { Lang, TextKey };
export { LANGUAGES, LANGUAGE_NAMES, LANGUAGE_LOCALES, detectLanguage, isLang, languageOfTag } from './languages';

const DICTS: Record<Lang, Record<TextKey, string>> = { en, tr, de, es, fr, it, pl, pt, ru, id };

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

export type TextParams = Record<string, string | number>;

const separators = new Map<Lang, string>();

/** The decimal separator of a language's number locale ('.' or ','). */
export function decimalSeparator(lang: Lang = current): string {
  let sep = separators.get(lang);
  if (sep === undefined) {
    try {
      const parts = new Intl.NumberFormat(LANGUAGE_LOCALES[lang]).formatToParts(1.5);
      sep = parts.find((p) => p.type === 'decimal')?.value ?? '.';
    } catch {
      sep = lang === 'en' ? '.' : ',';
    }
    separators.set(lang, sep);
  }
  return sep;
}

/**
 * Fixed-decimal number in the current language's locale (3.5 / 3,5). No
 * digit grouping: the game's numbers are small, and toFixed's rounding is
 * kept so every language shows the same value.
 */
export function fmt(n: number, digits = 1): string {
  const s = n.toFixed(digits);
  const sep = decimalSeparator();
  return sep === '.' ? s : s.replace('.', sep);
}

const scoreFormats = new Map<Lang, Intl.NumberFormat | null>();

/**
 * A whole number (a score) with the current language's digit grouping:
 * 12,480 / 12.480 / 12 480. Plain digits if Intl cannot format it.
 */
export function formatScore(n: number): string {
  const v = Math.round(n);
  let f = scoreFormats.get(current);
  if (f === undefined) {
    try {
      f = new Intl.NumberFormat(LANGUAGE_LOCALES[current], { maximumFractionDigits: 0 });
    } catch {
      f = null;
    }
    scoreFormats.set(current, f);
  }
  return f ? f.format(v) : String(v);
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
