/**
 * Writes tests/fixtures/baseline.json. Run with `npm run baseline`.
 */

import { writeFileSync } from 'node:fs';
import { buildBaseline } from './lib/baseline';

const out = 'tests/fixtures/baseline.json';
writeFileSync(out, `${JSON.stringify(buildBaseline(), null, 2)}\n`);
console.log(`wrote ${out}`);
