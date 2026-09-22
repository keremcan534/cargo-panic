/**
 * Text dictionary integrity: Turkish covers every English key with the same
 * placeholders, English campaign copy matches the level data, formatting.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEVELS } from '../../src/game/levels/levels';
import { detectLanguage, fmt, setLanguage, t } from '../../src/i18n';
import { en } from '../../src/i18n/en';
import type { TextKey } from '../../src/i18n/en';
import { tr } from '../../src/i18n/tr';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('Turkish has exactly the English keys', () => {
  assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
});

test('every Turkish string uses the same placeholders as its English source', () => {
  for (const key of Object.keys(en) as TextKey[]) {
    assert.deepEqual(placeholders(tr[key]), placeholders(en[key]), key);
    assert.ok(tr[key].trim().length > 0, `${key} is empty`);
  }
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

test('device language detection', () => {
  assert.equal(detectLanguage(['tr-TR', 'en-US']), 'tr');
  assert.equal(detectLanguage('en-GB'), 'en');
  assert.equal(detectLanguage(['de-DE', 'tr']), 'tr');
  assert.equal(detectLanguage(['fr-FR']), 'en');
  assert.equal(detectLanguage(undefined), 'en');
});
