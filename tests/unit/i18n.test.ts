/**
 * Text dictionary integrity: every language covers every English key with the
 * same placeholders and the same casing convention, English campaign copy
 * matches the level data, number formatting per language.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEVELS } from '../../src/game/levels/levels';
import {
  LANGUAGES,
  LANGUAGE_LOCALES,
  decimalSeparator,
  detectLanguage,
  fmt,
  formatScore,
  setLanguage,
  t,
} from '../../src/i18n';
import type { Lang } from '../../src/i18n';
import { de } from '../../src/i18n/de';
import { en } from '../../src/i18n/en';
import type { TextKey } from '../../src/i18n/en';
import { es } from '../../src/i18n/es';
import { fr } from '../../src/i18n/fr';
import { id } from '../../src/i18n/id';
import { it } from '../../src/i18n/it';
import { pl } from '../../src/i18n/pl';
import { pt } from '../../src/i18n/pt';
import { ru } from '../../src/i18n/ru';
import { tr } from '../../src/i18n/tr';

const DICTS: Record<Lang, Record<TextKey, string>> = { en, tr, de, es, fr, it, pl, pt, ru, id };
const KEYS = Object.keys(en) as TextKey[];

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every language has a dictionary', () => {
  assert.deepEqual(Object.keys(DICTS).sort(), [...LANGUAGES].sort());
});

for (const lang of LANGUAGES) {
  const dict = DICTS[lang];

  test(`${lang}: exactly the English keys`, () => {
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(en).sort());
  });

  test(`${lang}: every string is non-empty and uses the same placeholders as its English source`, () => {
    for (const key of KEYS) {
      assert.equal(typeof dict[key], 'string', key);
      assert.ok(dict[key].trim().length > 0, `${lang} ${key} is empty`);
      assert.deepEqual(placeholders(dict[key]), placeholders(en[key]), `${lang} ${key}`);
    }
  });

  test(`${lang}: all-caps English copy is all-caps here too (in the language's own upper case)`, () => {
    const locale = LANGUAGE_LOCALES[lang];
    for (const key of KEYS) {
      const src = en[key].replace(/\{\w+\}/g, '');
      if (!/[A-Z]/.test(src) || src !== src.toUpperCase()) continue;
      const text = dict[key].replace(/\{\w+\}/g, '');
      assert.equal(text, text.toLocaleUpperCase(locale), `${lang} ${key}: ${dict[key]}`);
    }
  });

  test(`${lang}: line breaks match the English source`, () => {
    for (const key of KEYS) {
      assert.equal(dict[key].split('\n').length, en[key].split('\n').length, `${lang} ${key}`);
    }
  });
}

test('the new keys are in every language: error.recovered', () => {
  for (const lang of LANGUAGES) assert.ok(DICTS[lang]['error.recovered'].length > 10, lang);
});

test('English campaign copy matches the level data', () => {
  for (const l of LEVELS) {
    assert.equal(en[`level.${l.id}.name` as TextKey], l.name);
    assert.equal(en[`level.${l.id}.objective` as TextKey], l.objective);
    assert.equal(en[`level.${l.id}.tip` as TextKey], l.tip);
  }
});

test('t fills placeholders and formats decimals per language', () => {
  setLanguage('en');
  assert.equal(t('hud.left', { left: 2, total: 5 }), '2 / 5 LEFT');
  assert.equal(t('block.imbalance', { limit: 2.5 }), 'IMBALANCE MUST DROP BELOW 2.5');
  setLanguage('tr');
  assert.equal(t('hud.left', { left: 2, total: 5 }), '2 / 5 KALDI');
  assert.equal(t('block.imbalance', { limit: 2.5 }), 'DENGESİZLİK 2,5 ALTINA İNMELİ');
  assert.equal(fmt(3), '3,0');
  setLanguage('en');
  assert.equal(fmt(3), '3.0');
});

test('fmt uses each language\'s decimal separator and keeps toFixed rounding', () => {
  const comma: Lang[] = ['tr', 'de', 'es', 'fr', 'it', 'pl', 'pt', 'ru', 'id'];
  for (const lang of LANGUAGES) {
    setLanguage(lang);
    const sep = comma.includes(lang) ? ',' : '.';
    assert.equal(decimalSeparator(), sep, lang);
    assert.equal(fmt(2.5), `2${sep}5`, lang);
    assert.equal(fmt(1.25, 2), `1${sep}25`, lang);
    assert.equal(fmt(1234.5), `1234${sep}5`, `${lang}: no digit grouping`);
    assert.equal(fmt(-0.25), (-0.25).toFixed(1).replace('.', sep), lang);
    assert.equal(t('hud.fixIt', { hazard: 'X', secs: 3.5 }).includes(`3${sep}5`), true, lang);
  }
  setLanguage('en');
});

test('device language detection', () => {
  assert.equal(detectLanguage(['tr-TR', 'en-US']), 'tr');
  assert.equal(detectLanguage('en-GB'), 'en');
  assert.equal(detectLanguage(['de-DE', 'tr']), 'de');
  assert.equal(detectLanguage(['ja-JP', 'tr']), 'tr');
  assert.equal(detectLanguage(['ja-JP']), 'en');
  assert.equal(detectLanguage(undefined), 'en');
});

test("scores use each language's digit grouping", () => {
  const want: Record<Lang, string> = {
    en: '124,800',
    tr: '124.800',
    de: '124.800',
    es: '124.800',
    fr: '124 800',
    it: '124.800',
    pl: '124 800',
    pt: '124.800',
    ru: '124 800',
    id: '124.800',
  };
  for (const lang of LANGUAGES) {
    setLanguage(lang);
    assert.equal(formatScore(124800.4), want[lang], lang);
    assert.equal(formatScore(0), '0', lang);
    assert.equal(formatScore(980), '980', lang);
  }
  setLanguage('en');
});
