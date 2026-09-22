/**
 * Architecture rules, checked on the runtime import graph.
 *
 * The rules code (balance, placement, hazards, solver, levels) must stay free
 * of three.js and of the DOM so it runs identically under both renderers and
 * headless in the validators.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { chainTo, isThree, parseImports, reachable } from '../../scripts/lib/import-graph';

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

// ---------------------------------------------------------------------------
// Renderer boundary: only src/render/three/** may use three.js. The app shell,
// the game controller, the input layer and the DOM screens talk to a Stage /
// GameView and must not pull three in (so a 2D start never loads it).
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    if (statSync(f).isDirectory()) out.push(...sourceFiles(f));
    else if (f.endsWith('.ts') && !f.endsWith('.d.ts')) out.push(f);
  }
  return out;
}

const uiScreens = readdirSync('src/ui')
  .filter((f) => f.endsWith('.ts'))
  .map((f) => `src/ui/${f}`);

const THREE_FREE = [
  'src/app/Game.ts',
  'src/app/Router.ts',
  'src/app/App.ts',
  'src/app/FrameLoop.ts',
  'src/input/InteractionController.ts',
  'src/render/GameView.ts',
  'src/render/Stage.ts',
  'src/render/layout.ts',
  'src/render/Tween.ts',
  ...uiScreens,
];

for (const entry of THREE_FREE) {
  test(`${entry} does not reach three.js`, () => {
    assert.equal(chainTo(entry, isThree), null);
  });
}

test('only src/render/three/** imports three.js directly', () => {
  const offenders = sourceFiles('src')
    .filter((f) => parseImports(f).packages.some(isThree))
    .map((f) => relative(process.cwd(), f).split('\\').join('/'))
    .filter((f) => !f.startsWith('src/render/three/'));
  assert.deepEqual(offenders, []);
});

test('only src/main.ts and src/render/three/** reach three.js at all', () => {
  const offenders = sourceFiles('src')
    .map((f) => relative(process.cwd(), f).split('\\').join('/'))
    .filter((f) => !f.startsWith('src/render/three/') && f !== 'src/main.ts')
    .filter((f) => chainTo(f, isThree) !== null);
  assert.deepEqual(offenders, []);
});
