/**
 * The Google Play listing (fastlane/metadata/android/<locale>, docs/RELEASE.md):
 * one per language the game speaks, every text within Google Play's limits,
 * titles free of what the metadata policy forbids, six screenshots each, and
 * the icon and feature graphic in the formats the Play Console takes.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { LANGUAGES, languageOfTag } from '../../src/i18n/languages';

const ROOT = join(import.meta.dirname, '../../fastlane/metadata/android');
const locales = readdirSync(ROOT).sort();

/** Google Play's limits, in characters (Play Console Help: store listing, release notes). */
const LIMITS: Readonly<Record<string, number>> = {
  'title.txt': 30,
  'short_description.txt': 80,
  'full_description.txt': 4000,
  'changelogs/default.txt': 500,
};

const read = (locale: string, file: string) => readFileSync(join(ROOT, locale, file), 'utf8').trim();
const chars = (s: string) => [...s].length;

/** Width, height and PNG colour type (6 = RGBA) of a PNG file. */
function png(file: string) {
  const b = readFileSync(file);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', `${file} is a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
}

/** Width and height of a baseline or progressive JPEG. */
function jpeg(file: string) {
  const b = readFileSync(file);
  assert.equal(b.readUInt16BE(0), 0xffd8, `${file} is a JPEG`);
  for (let i = 2; i < b.length; ) {
    const marker = b.readUInt16BE(i);
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xffc0 && marker <= 0xffc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error(`${file}: no frame header`);
}

describe('the Google Play listing', () => {
  it('is written in each language the game speaks, and in no other', () => {
    assert.deepEqual(locales.map((l) => languageOfTag(l)).sort(), [...LANGUAGES].sort());
  });

  for (const locale of locales) {
    it(`${locale}: has every text, each within its limit`, () => {
      for (const [file, limit] of Object.entries(LIMITS)) {
        assert.ok(existsSync(join(ROOT, locale, file)), `${locale}/${file} exists`);
        const n = chars(read(locale, file));
        assert.ok(n > 0, `${locale}/${file} is not empty`);
        assert.ok(n <= limit, `${locale}/${file}: ${n} > ${limit}`);
      }
    });

    it(`${locale}: the title follows the metadata policy`, () => {
      const title = read(locale, 'title.txt');
      assert.doesNotMatch(title, /\p{Extended_Pictographic}/u, 'no emoji');
      assert.doesNotMatch(title, /#1|\bbest\b|\bfree\b|\btop\b|%|\$|€|ücretsiz|kostenlos|gratis|gratuit|darmowy|бесплатн/iu, 'no ranking, price or promotion');
      const letters = title.replace(/[^\p{L}]/gu, '');
      assert.notEqual(letters, letters.toLocaleUpperCase(), 'not all capitals');
    });

    it(`${locale}: has six 1920 x 1080 screenshots`, () => {
      const dir = join(ROOT, locale, 'images', 'phoneScreenshots');
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(jpe?g|png)$/.test(f)) : [];
      assert.equal(files.length, 6, `${locale}: ${files.length} screenshots`);
      for (const f of files) {
        const size = f.endsWith('.png') ? png(join(dir, f)) : jpeg(join(dir, f));
        assert.deepEqual([size.w, size.h], [1920, 1080], f);
      }
    });
  }

  it('has a 512 x 512 32-bit (RGBA) PNG icon and a 1024 x 500 feature graphic', () => {
    const images = join(ROOT, 'en-US', 'images');
    const icon = png(join(images, 'icon.png'));
    assert.deepEqual([icon.w, icon.h, icon.colorType], [512, 512, 6]);
    assert.ok(readFileSync(join(images, 'icon.png')).length <= 1024 * 1024, 'icon at most 1024 KB');
    const feature = jpeg(join(images, 'featureGraphic.jpg'));
    assert.deepEqual([feature.w, feature.h], [1024, 500]);
  });
});
