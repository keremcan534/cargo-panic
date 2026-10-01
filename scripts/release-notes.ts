/**
 * Prints every listing language's release notes in the form the Play Console's
 * "Release notes" box takes, each between its language's tags:
 *
 *   npx tsx scripts/release-notes.ts        the notes every release shares (changelogs/default.txt)
 *   npx tsx scripts/release-notes.ts 57     build 57's own notes (changelogs/57.txt) where a language has them
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LISTINGS = join(import.meta.dirname, '../fastlane/metadata/android');
/** Google Play's limit for one language's release notes, in characters. */
const LIMIT = 500;

const build = process.argv[2];
const blocks: string[] = [];
for (const locale of readdirSync(LISTINGS).sort()) {
  const dir = join(LISTINGS, locale, 'changelogs');
  const file = [build ? join(dir, `${build}.txt`) : null, join(dir, 'default.txt')].find((f) => f && existsSync(f));
  if (!file) continue;
  const text = readFileSync(file, 'utf8').trim();
  if ([...text].length > LIMIT) throw new Error(`${file}: Google Play takes at most ${LIMIT} characters`);
  blocks.push(`<${locale}>\n${text}\n</${locale}>`);
}
console.log(blocks.join('\n'));
