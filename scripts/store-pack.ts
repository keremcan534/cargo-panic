/**
 * Packs the Google Play listing for hand upload (marketing/out/store/, git-ignored):
 *   cargo-panic-store-images.zip  every language's images, one folder per locale
 *   translations.csv              language, code, app name, short and full description
 *   release-notes.txt             the release notes in the Play Console's <locale>…</locale> form
 *
 *   npx tsx scripts/store-pack.ts
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const LISTINGS = join(ROOT, 'fastlane/metadata/android');
const OUT = join(ROOT, 'marketing/out/store');

/** English names of the listing languages, for the CSV's first column. */
const NAMES: Record<string, string> = {
  'en-US': 'English (United States)',
  'tr-TR': 'Turkish',
  'de-DE': 'German',
  'es-ES': 'Spanish (Spain)',
  'fr-FR': 'French (France)',
  'it-IT': 'Italian',
  'pl-PL': 'Polish',
  'pt-BR': 'Portuguese (Brazil)',
  'ru-RU': 'Russian',
  id: 'Indonesian',
};

const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;
const read = (locale: string, file: string) => readFileSync(join(LISTINGS, locale, file), 'utf8').trim();

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const locales = readdirSync(LISTINGS).sort((a, b) => (a === 'en-US' ? -1 : b === 'en-US' ? 1 : a.localeCompare(b)));

// Images, one folder per locale.
const staging = join(OUT, 'images');
for (const locale of locales) {
  const src = join(LISTINGS, locale, 'images');
  if (existsSync(src)) cpSync(src, join(staging, locale), { recursive: true });
}
execFileSync('zip', ['-q', '-r', '-X', join(OUT, 'cargo-panic-store-images.zip'), '.'], { cwd: staging });
rmSync(staging, { recursive: true, force: true });

// Store texts as one CSV (UTF-8 with a BOM so spreadsheet apps read the accents).
const rows = [['Language', 'Code', 'App name', 'Short description', 'Full description']];
for (const locale of locales) {
  rows.push([NAMES[locale] ?? locale, locale, read(locale, 'title.txt'), read(locale, 'short_description.txt'), read(locale, 'full_description.txt')]);
}
writeFileSync(join(OUT, 'translations.csv'), '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n');

// Release notes in the Console's tag form.
const notes = execFileSync(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts/release-notes.ts')], { encoding: 'utf8' });
writeFileSync(join(OUT, 'release-notes.txt'), notes);

console.log(`${OUT}: cargo-panic-store-images.zip, translations.csv, release-notes.txt (${locales.length} languages)`);
