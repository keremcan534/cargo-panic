/**
 * Architecture rules, checked on the runtime import graph.
 *
 * The rules code (balance, placement, hazards, solver, levels) must stay free
 * of three.js and of the DOM so it runs identically under both renderers and
 * headless in the validators.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
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
// Renderer boundary: only src/render/three/** may use three.js. The entry,
// the app shell, the game controller, the input layer, the 2D renderer and
// the DOM screens talk to a Stage / GameView and must not pull three in, so
// a 2D start never loads it. 3D is loaded lazily by src/render/createStage.ts.
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

const rel = (f: string) => relative(process.cwd(), f).split(sep).join('/');

const uiScreens = readdirSync('src/ui')
  .filter((f) => f.endsWith('.ts'))
  .map((f) => `src/ui/${f}`);

const THREE_FREE = [
  'src/main.ts',
  'src/app/Game.ts',
  'src/app/Router.ts',
  'src/app/App.ts',
  'src/app/FrameLoop.ts',
  'src/app/StageHost.ts',
  'src/input/InteractionController.ts',
  'src/render/GameView.ts',
  'src/render/Stage.ts',
  'src/render/createStage.ts',
  'src/render/hero.ts',
  'src/render/quality.ts',
  'src/render/layout.ts',
  'src/render/Tween.ts',
  'src/render/canvas2d/Canvas2DStage.ts',
  ...uiScreens,
];

for (const entry of THREE_FREE) {
  test(`${entry} does not reach three.js`, () => {
    assert.equal(chainTo(entry, isThree), null);
  });
}

test('src/main.ts cannot reach three.js through static imports', () => {
  // The 2D first-load path: nothing the entry imports at runtime pulls three in.
  assert.equal(chainTo('src/main.ts', isThree), null);
});

test('only src/render/three/** imports three.js directly', () => {
  const offenders = sourceFiles('src')
    .filter((f) => parseImports(f).packages.some(isThree))
    .map(rel)
    .filter((f) => !f.startsWith('src/render/three/'));
  assert.deepEqual(offenders, []);
});

test('only src/render/three/** reaches three.js at all', () => {
  const offenders = sourceFiles('src')
    .map(rel)
    .filter((f) => !f.startsWith('src/render/three/'))
    .filter((f) => chainTo(f, isThree) !== null);
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// The one door into the 3D renderer is a dynamic import in createStage.ts.
// Type-only imports are erased by the compiler and are fine anywhere.
// ---------------------------------------------------------------------------

const THREE_DIR = resolve('src/render/three') + sep;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function dynamicImports(file: string): string[] {
  const src = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of src.matchAll(DYNAMIC_IMPORT)) {
    if (m[1].startsWith('.')) out.push(resolve(dirname(file), m[1]));
  }
  return out;
}

test('nothing outside src/render/three imports a module under it at runtime', () => {
  const offenders: string[] = [];
  for (const f of sourceFiles('src')) {
    if (rel(f).startsWith('src/render/three/')) continue;
    for (const dep of parseImports(f).local) if (dep.startsWith(THREE_DIR)) offenders.push(`${rel(f)} -> ${rel(dep)}`);
  }
  assert.deepEqual(offenders, []);
});

test('the 3D stage is reached only by the dynamic import in src/render/createStage.ts', () => {
  const doors: string[] = [];
  for (const f of sourceFiles('src')) {
    if (rel(f).startsWith('src/render/three/')) continue;
    for (const target of dynamicImports(f)) if (target.startsWith(THREE_DIR)) doors.push(`${rel(f)} -> ${rel(target)}`);
  }
  assert.deepEqual(doors, ['src/render/createStage.ts -> src/render/three/ThreeStage']);
});
