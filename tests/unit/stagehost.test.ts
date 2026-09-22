/**
 * Stage creation and swapping, with fake stages (no DOM, no WebGL):
 *
 * - createStage: 2D straight away; 3D through the lazy loader; any 3D
 *   failure (rejected import, empty module, throwing constructor) disposes
 *   what was made, removes stray canvases and falls back to 2D.
 * - StageHost: the only writer of loop.stage; the exact detach -> dispose ->
 *   create -> loop.stage -> attach order; one live stage at a time; queued
 *   switches (latest wins) with stale stages disposed on arrival; busy/idle;
 *   context events only from the live stage.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { StageHost } from '../../src/app/StageHost';
import type { StageCreator } from '../../src/app/StageHost';
import { createStage } from '../../src/render/createStage';
import type { StageFactories, StageModule3D } from '../../src/render/createStage';
import type { RenderMode } from '../../src/render/GameView';
import type { Stage, StageContextEvent, StageOptions } from '../../src/render/Stage';
import { Tweens } from '../../src/render/Tween';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeEl {
  constructor(
    readonly nodeName: string,
    private root: FakeRoot,
  ) {}
  remove() {
    this.root.children = this.root.children.filter((c) => c !== this);
  }
}

class FakeRoot {
  children: FakeEl[] = [];
  add(nodeName = 'CANVAS'): FakeEl {
    const e = new FakeEl(nodeName, this);
    this.children.push(e);
    return e;
  }
}

let serial = 0;
const log: string[] = [];

class FakeStage implements Stage {
  readonly id = ++serial;
  readonly tweens = new Tweens();
  readonly struggling = false;
  disposed = false;
  private el: FakeEl;
  private ctxListeners = new Set<(e: StageContextEvent) => void>();
  constructor(
    readonly mode: RenderMode,
    root: FakeRoot,
  ) {
    this.el = root.add();
    log.push(`create:${mode}#${this.id}`);
  }
  get canvas(): HTMLCanvasElement {
    return this.el as unknown as HTMLCanvasElement;
  }
  createGameView(): never {
    throw new Error('not in these tests');
  }
  showBackdrop() {
    return { dispose() {} };
  }
  setReducedMotion() {}
  setQuality() {}
  onContextEvent(cb: (e: StageContextEvent) => void) {
    this.ctxListeners.add(cb);
    return () => this.ctxListeners.delete(cb);
  }
  fire(e: StageContextEvent) {
    for (const cb of this.ctxListeners) cb(e);
  }
  get contextListeners() {
    return this.ctxListeners.size;
  }
  render() {}
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.el.remove();
    log.push(`dispose:${this.mode}#${this.id}`);
  }
}

const OPTS: StageOptions = { reducedMotion: false, quality: 'auto' };
const asRoot = (r: FakeRoot) => r as unknown as HTMLElement;

function factories(root: FakeRoot, load3d: () => Promise<StageModule3D>): StageFactories {
  return { load3d, make2d: () => new FakeStage('2d', root) };
}

const module3d = (root: FakeRoot): StageModule3D => ({
  ThreeStage: class {
    constructor() {
      return new FakeStage('3d', root);
    }
  } as unknown as StageModule3D['ThreeStage'],
});

// ---------------------------------------------------------------------------

describe('createStage', () => {
  test('2D never touches the 3D loader', async () => {
    const root = new FakeRoot();
    let loads = 0;
    const r = await createStage('2d', asRoot(root), OPTS, factories(root, async () => (loads++, module3d(root))));
    assert.equal(r.stage.mode, '2d');
    assert.equal(r.fellBack, false);
    assert.equal(loads, 0);
    assert.equal(root.children.length, 1);
  });

  test('3D comes from the lazy loader', async () => {
    const root = new FakeRoot();
    const r = await createStage('3d', asRoot(root), OPTS, factories(root, async () => module3d(root)));
    assert.equal(r.stage.mode, '3d');
    assert.equal(r.fellBack, false);
  });

  const failures: [string, (root: FakeRoot) => () => Promise<StageModule3D>][] = [
    ['the 3D chunk fails to load', () => () => Promise.reject(new Error('Failed to fetch dynamically imported module'))],
    ['the module resolves empty (handled vite:preloadError)', () => () => Promise.resolve(undefined as unknown as StageModule3D)],
    [
      'the constructor throws after adding a canvas (no WebGL)',
      (root) => () =>
        Promise.resolve({
          ThreeStage: class {
            constructor() {
              root.add('CANVAS');
              throw new Error('Error creating WebGL context.');
            }
          } as unknown as StageModule3D['ThreeStage'],
        }),
    ],
  ];
  for (const [name, loader] of failures) {
    test(`falls back to 2D when ${name}, leaving one canvas`, async () => {
      const root = new FakeRoot();
      const keep = root.add('DIV'); // unrelated children are left alone
      const warn = console.warn;
      console.warn = () => undefined;
      try {
        const r = await createStage('3d', asRoot(root), OPTS, factories(root, loader(root)));
        assert.equal(r.stage.mode, '2d');
        assert.equal(r.fellBack, true);
        assert.ok(r.error);
        assert.deepEqual(
          root.children.map((c) => c.nodeName),
          ['DIV', 'CANVAS'],
        );
        assert.ok(root.children.includes(keep));
      } finally {
        console.warn = warn;
      }
    });
  }
});

// ---------------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A creator whose 3D stages arrive only when the test says so. */
function gatedCreator(root: FakeRoot) {
  const gates: { mode: RenderMode; open: () => void }[] = [];
  const create: StageCreator = (mode) => {
    const d = deferred<void>();
    gates.push({ mode, open: () => d.resolve() });
    return d.promise.then(() => ({ stage: new FakeStage(mode, root), fellBack: false }));
  };
  return { create, gates };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('StageHost', () => {
  test('boot makes the first stage and is the one writer of loop.stage', async () => {
    log.length = 0;
    const root = new FakeRoot();
    const loop = { stage: null as Stage | null };
    const host = new StageHost(loop, asRoot(root), () => OPTS, (mode) =>
      Promise.resolve({ stage: new FakeStage(mode, root), fellBack: false }),
    );
    const r = await host.boot('2d');
    assert.deepEqual(r, { requested: '2d', mode: '2d', fellBack: false });
    assert.equal(loop.stage, host.stage);
    assert.equal(host.mode, '2d');
    assert.equal(host.busy, false);
  });

  test('a switch runs detach -> dispose -> create -> loop.stage -> attach, one live stage throughout', async () => {
    log.length = 0;
    const root = new FakeRoot();
    const loop = { stage: null as Stage | null };
    const host = new StageHost(loop, asRoot(root), () => OPTS, (mode) =>
      Promise.resolve({ stage: new FakeStage(mode, root), fellBack: false }),
    );
    await host.boot('3d');
    const first = host.stage as FakeStage;
    host.setScreenHooks({
      detach: () => log.push(`detach(loop=${(loop.stage as FakeStage | null)?.id ?? 'none'})`),
      attach: (stage, result) =>
        log.push(`attach:${stage.mode}#${(stage as FakeStage).id}(loop=${(loop.stage as FakeStage).id},${result.mode})`),
    });
    log.length = 0;
    const r = await host.switchTo('2d');
    assert.equal(r.mode, '2d');
    const second = host.stage as FakeStage;
    assert.deepEqual(log, [
      `detach(loop=${first.id})`,
      `dispose:3d#${first.id}`,
      `create:2d#${second.id}`,
      `attach:2d#${second.id}(loop=${second.id},2d)`,
    ]);
    assert.equal(first.disposed, true);
    assert.equal(first.contextListeners, 0, 'context subscription dropped with the old stage');
    assert.equal(root.children.length, 1);
    assert.equal(loop.stage, second);
  });

  test('busy and idle cover a pending switch; queued requests: latest wins, stale stages die on arrival', async () => {
    log.length = 0;
    const root = new FakeRoot();
    const loop = { stage: null as Stage | null };
    const { create, gates } = gatedCreator(root);
    const host = new StageHost(loop, asRoot(root), () => OPTS, create);
    const booting = host.boot('2d');
    await tick();
    gates[0].open();
    await booting;

    const events: string[] = [];
    host.onEvent((e) => events.push(e.type === 'busy' ? `busy:${e.busy}` : e.type));
    const a = host.switchTo('3d');
    assert.equal(host.busy, true, 'busy from the moment of the request');
    assert.deepEqual(events, ['busy:true']);
    await tick();
    assert.equal(loop.stage, null, 'nothing is drawn while the new stage is being made');
    const b = host.switchTo('2d'); // arrives while 3D is still loading
    const c = host.switchTo('3d');
    let idle = false;
    void host.idle.then(() => (idle = true));
    assert.equal(gates.length, 2);

    gates[1].open(); // the first 3D arrives, but two newer requests exist: stale
    await tick();
    const stale = log.filter((l) => l.startsWith('create:3d'));
    assert.equal(stale.length, 1);
    assert.ok(log.some((l) => l.startsWith('dispose:3d')), 'the stale stage disposed itself');
    assert.equal(loop.stage, null, 'a stale stage never goes live');
    assert.equal(idle, false);
    assert.equal(gates.length, 3, 'the latest request (3D) is being made now');
    assert.equal(gates[2].mode, '3d');

    gates[2].open();
    const results = await Promise.all([a, b, c]);
    for (const r of results) assert.equal(r.mode, '3d', 'every caller sees the final result');
    await tick();
    assert.equal(idle, true);
    assert.equal(host.busy, false);
    assert.equal(host.mode, '3d');
    assert.equal(root.children.length, 1, 'exactly one canvas');
    assert.deepEqual(events, ['busy:true', 'switched', 'busy:false']);
  });

  test('context events are forwarded from the live stage only', async () => {
    const root = new FakeRoot();
    const loop = { stage: null as Stage | null };
    const host = new StageHost(loop, asRoot(root), () => OPTS, (mode) =>
      Promise.resolve({ stage: new FakeStage(mode, root), fellBack: false }),
    );
    await host.boot('3d');
    const first = host.stage as FakeStage;
    const seen: string[] = [];
    host.onEvent((e) => {
      if (e.type === 'context') seen.push(`${e.event}#${(e.stage as FakeStage).id}`);
    });
    first.fire('lost');
    first.fire('restored');
    await host.switchTo('2d');
    first.fire('lost'); // a disposed stage has nothing to say
    assert.deepEqual(seen, [`lost#${first.id}`, `restored#${first.id}`]);
  });

  test('a 3D request that falls back reports it; the effective mode is 2D', async () => {
    const root = new FakeRoot();
    const loop = { stage: null as Stage | null };
    const host = new StageHost(loop, asRoot(root), () => OPTS, () =>
      Promise.resolve({ stage: new FakeStage('2d', root), fellBack: true }),
    );
    const r = await host.boot('3d');
    assert.deepEqual(r, { requested: '3d', mode: '2d', fellBack: true });
    assert.equal(host.mode, '2d');
  });
});
