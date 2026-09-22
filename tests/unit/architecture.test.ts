/**
 * Architecture rules, checked on the runtime import graph.
 *
 * The rules code (balance, placement, hazards, solver, levels) must stay free
 * of three.js and of the DOM so it runs identically under both renderers and
 * headless in the validators.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { test } from 'node:test';
import { chainTo, isThree, reachable } from '../../scripts/lib/import-graph';

const PURE_ENTRIES = [
  'src/game/systems/BalanceSystem.ts',
  'src/game/systems/PlacementSystem.ts',
  'src/game/systems/HazardSystem.ts',
  'src/game/systems/Solver.ts',
  'src/game/systems/RunManager.ts',
  'src/game/levels/generator.ts',
  'src/game/levels/levels.ts',
  'src/game/session/index.ts',
];

/** DOM globals a pure module must not touch at load or call time. */
const DOM_GLOBAL = /\b(document|window|navigator|localStorage|requestAnimationFrame|HTMLElement)\b/;

for (const entry of PURE_ENTRIES) {
  test(`${entry} does not reach three.js`, () => {
    assert.equal(chainTo(entry, isThree), null);
  });

  test(`${entry} does not reach the DOM`, () => {
    for (const [file] of reachable(entry)) {
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      // RunManager.seedFromUrl guards `window` in a try block; that is the one
      // sanctioned browser touch-point in the systems folder until A1 moves it.
      if (file.endsWith('RunManager.ts')) continue;
      assert.doesNotMatch(src, DOM_GLOBAL, `${relative(process.cwd(), file)} references a DOM global`);
    }
  });
}
