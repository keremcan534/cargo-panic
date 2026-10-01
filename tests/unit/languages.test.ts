/**
 * The language list: names, locales, device-tag matching, and the save
 * sanitiser that keeps only languages the game speaks (null follows the device).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { blankSave, sanitizeV2 } from '../../src/game/save/schema';
import {
  LANGUAGES,
  LANGUAGE_LOCALES,
  LANGUAGE_NAMES,
  detectLanguage,
  isLang,
  languageOfTag,
} from '../../src/i18n/languages';

describe('language list', () => {
  test('the ten languages, each named in itself', () => {
    assert.deepEqual([...LANGUAGES].sort(), ['de', 'en', 'es', 'fr', 'id', 'it', 'pl', 'pt', 'ru', 'tr']);
    assert.deepEqual(
      LANGUAGES.map((l) => LANGUAGE_NAMES[l]),
      [
        'Bahasa Indonesia',
        'Deutsch',
        'English',
        'Español',
        'Français',
        'Italiano',
        'Polski',
        'Português (Brasil)',
        'Türkçe',
        'Русский',
      ],
    );
  });

  test('every language has a number locale Intl understands', () => {
    for (const l of LANGUAGES) {
      const locale = LANGUAGE_LOCALES[l];
      assert.match(locale, new RegExp(`^${l}-[A-Z]{2}$`));
      assert.deepEqual(Intl.NumberFormat.supportedLocalesOf([locale]), [locale], locale);
    }
    assert.equal(LANGUAGE_LOCALES.pt, 'pt-BR');
  });
});

describe('device language tags', () => {
  const cases: [string, string | null][] = [
    ['en', 'en'],
    ['en-US', 'en'],
    ['EN_gb', 'en'],
    ['tr-TR', 'tr'],
    ['de-AT', 'de'],
    ['de_CH', 'de'],
    ['es-419', 'es'],
    ['es-MX', 'es'],
    ['fr-CA', 'fr'],
    ['it-IT', 'it'],
    ['pl-PL', 'pl'],
    ['pt-BR', 'pt'],
    ['pt-PT', 'pt'],
    ['pt', 'pt'],
    ['ru-RU', 'ru'],
    ['ru-UA', 'ru'],
    ['id-ID', 'id'],
    ['in-ID', 'id'],
    ['in', 'id'],
    [' de ', 'de'],
    ['ja-JP', null],
    ['zh-Hans-CN', null],
    ['', null],
  ];
  for (const [tag, want] of cases) {
    test(`${JSON.stringify(tag)} -> ${want}`, () => assert.equal(languageOfTag(tag), want));
  }

  test('detectLanguage takes the first language the game speaks, English when none', () => {
    assert.equal(detectLanguage(['ja-JP', 'pt-PT', 'en-US']), 'pt');
    assert.equal(detectLanguage(['in-ID']), 'id');
    assert.equal(detectLanguage(['tr-TR', 'en-US']), 'tr');
    assert.equal(detectLanguage('de-DE'), 'de');
    assert.equal(detectLanguage(['ja-JP', 'ko-KR']), 'en');
    assert.equal(detectLanguage([]), 'en');
    assert.equal(detectLanguage(undefined), 'en');
  });

  test('isLang', () => {
    for (const l of LANGUAGES) assert.ok(isLang(l));
    for (const v of ['EN', 'in', 'pt-BR', 'system', '', null, undefined, 3, {}]) assert.equal(isLang(v), false, String(v));
  });
});

describe('save sanitiser: settings.language', () => {
  const withLanguage = (language: unknown) => {
    const d = blankSave() as unknown as { settings: Record<string, unknown> };
    d.settings.language = language;
    return sanitizeV2(JSON.parse(JSON.stringify(d)), 25)!.data.settings.language;
  };

  test('keeps every language the game speaks', () => {
    for (const l of LANGUAGES) assert.equal(withLanguage(l), l);
  });

  test('null (follow the device) stays null', () => {
    assert.equal(blankSave().settings.language, null);
    assert.equal(withLanguage(null), null);
  });

  test('anything else follows the device', () => {
    for (const v of ['EN', 'pt-BR', 'in', 'ja', 'system', '', 7, true, {}, []]) {
      assert.equal(withLanguage(v), null, JSON.stringify(v));
    }
    const d = blankSave() as unknown as { settings: Record<string, unknown> };
    delete d.settings.language;
    assert.equal(sanitizeV2(d, 25)!.data.settings.language, null);
  });
});
