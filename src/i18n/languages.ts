/**
 * The languages the game speaks: their codes, each one's own name for the
 * language picker, the locale its numbers are written in, and how a device
 * language tag maps onto them.
 *
 * Pure data (no DOM): the save sanitiser and the text lookup both use it.
 */

/** In the order the picker lists them: by their own names, the Latin alphabet first. */
export const LANGUAGES = ['id', 'de', 'en', 'es', 'fr', 'it', 'pl', 'pt', 'tr', 'ru'] as const;
export type Lang = (typeof LANGUAGES)[number];

/** What the game speaks when the device asks for none of its languages. */
export const FALLBACK_LANGUAGE: Lang = 'en';

/** Each language's name in itself, as the picker shows it. */
export const LANGUAGE_NAMES: Readonly<Record<Lang, string>> = {
  id: 'Bahasa Indonesia',
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  pl: 'Polski',
  pt: 'Português (Brasil)',
  tr: 'Türkçe',
  ru: 'Русский',
};

/** The locale each language writes its numbers in (decimal separator). */
export const LANGUAGE_LOCALES: Readonly<Record<Lang, string>> = {
  id: 'id-ID',
  de: 'de-DE',
  en: 'en-GB',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  pl: 'pl-PL',
  pt: 'pt-BR',
  tr: 'tr-TR',
  ru: 'ru-RU',
};

export function isLang(value: unknown): value is Lang {
  return (LANGUAGES as readonly unknown[]).includes(value);
}

/**
 * The game's language for one language tag (BCP 47 as browsers give them:
 * `pt-PT`, `es-419`, `in-ID`, `de_AT`), by its base; null when the game does
 * not speak it. Older Android reports Indonesian as `in`.
 */
export function languageOfTag(tag: string): Lang | null {
  const base = tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  const lang = base === 'in' ? 'id' : base;
  return isLang(lang) ? lang : null;
}

/** The first of the device's languages the game speaks; English when none. */
export function detectLanguage(locales: readonly string[] | string | undefined): Lang {
  const list = typeof locales === 'string' ? [locales] : (locales ?? []);
  for (const tag of list) {
    const lang = languageOfTag(tag);
    if (lang) return lang;
  }
  return FALLBACK_LANGUAGE;
}
