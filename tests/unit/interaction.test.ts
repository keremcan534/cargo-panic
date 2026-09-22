/**
 * The pointer state machine against a real GameSession and a fake view.
 * Pointer events are plain objects; the fake view reports whatever pick and
 * drop target a test sets, and records every call it gets.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import type { LevelDef } from '../../src/game/levels/types';
import { GameSession } from '../../src/game/session';
import { InteractionController } from '../../src/input/InteractionController';
import type { InteractionHooks, PointerInput } from '../../src/input/InteractionController';
import type {
  BoardView,
  ClientPoint,
  DispatchCallbacks,
  DropTarget,
  GameView,
  PointerSample,
  ViewHighlight,
} from '../../src/render/GameView';
import type { TargetKind } from '../../src/game/session/types';

/** One 5-slot shelf; a heavy crate at the edge tips it (torque 10 > 4). */
const TIP: LevelDef = {
  id: 900,
  name: 'TEST TIP',
  objective: '',
  shelves: [{ slots: 5, maxWeight: 20 }],
  packages: ['heavy', 'standard', 'standard'],
  balanceTolerance: 4,
};

class FakeView implements GameView {
  readonly mode = '2d' as const;
  calls: string[] = [];
  pick: number | null = null;
  target: DropTarget | null = null;

  mount(_b: BoardView) {
    this.calls.push('mount');
  }
  sync(_b: BoardView) {
    this.calls.push('sync');
  }
  update(_dt: number) {}
  dispose() {}
  pickCargo(_p: PointerSample, candidates: readonly number[]) {
    this.calls.push(`pick:${candidates.join(',')}`);
    return this.pick !== null && candidates.includes(this.pick) ? this.pick : null;
  }
  beginDrag(id: number, p: PointerSample) {
    this.calls.push(`beginDrag:${id}:${p.touch ? 'touch' : 'mouse'}`);
  }
  moveDrag(p: PointerSample) {
    this.calls.push(`moveDrag:${p.clientX},${p.clientY}`);
  }
  dragTarget() {
    return this.target;
  }
  targetAt(_p: PointerSample, _slots: number) {
    return this.target;
  }
  endDrag() {
    this.calls.push('endDrag');
  }
  showGhost(t: { shelf: number; slot: number }, slots: number, kind: TargetKind) {
    this.calls.push(`ghost:${t.shelf}:${t.slot}:${slots}:${kind}`);
  }
  hideGhost() {
    this.calls.push('hideGhost');
  }
  setBeltHover(on: boolean) {
    this.calls.push(`belt:${on}`);
  }
  setSelected(_id: number | null) {}
  showHint(_id: number, _t: { shelf: number; slot: number }) {}
  clearHint() {}
  highlight(_h: ViewHighlight) {}
  cargoPlaced(id: number, t: { shelf: number; slot: number }, opts: { quiet: boolean; onLanded?: () => void }) {
    this.calls.push(`cargoPlaced:${id}:${t.shelf}:${t.slot}:${opts.quiet ? 'quiet' : 'loud'}`);
    opts.onLanded?.();
  }
  cargoToBelt(id: number) {
    this.calls.push(`cargoToBelt:${id}`);
  }
  cargoReturn(id: number) {
    this.calls.push(`cargoReturn:${id}`);
  }
  celebrate() {}
  dispatch(_cb?: DispatchCallbacks) {}
  failCollapse(_d: number) {}
  failOverload(_t: number, _d: number) {}
  failFragile(_id: number) {}
  clientPointOf(): ClientPoint | null {
    return null;
  }

  /** Calls matching a prefix, e.g. 'cargo' for every transition. */
  only(prefix: string) {
    return this.calls.filter((c) => c.startsWith(prefix));
  }
}

type Listener = (e: Event) => void;

class FakeSurface {
  listeners = new Map<string, Set<Listener>>();
  captured = new Set<number>();
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  setPointerCapture(id: number) {
    this.captured.add(id);
  }
  releasePointerCapture(id: number) {
    this.captured.delete(id);
  }
  hasPointerCapture(id: number) {
    return this.captured.has(id);
  }
  emit(type: string, e: Partial<PointerInput> = {}) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e as unknown as Event);
  }
  count() {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}

function recorder() {
  const log: string[] = [];
  const hooks: InteractionHooks = {
    grabbed: (id) => log.push(`grabbed:${id}`),
    preview: (net) => log.push(`preview:${net === null ? 'none' : net}`),
    beltHover: (on) => log.push(`beltHover:${on}`),
    rejected: (reason) => log.push(`rejected:${reason}`),
    placed: (id, quiet) => log.push(`placed:${id}:${quiet}`),
    landed: (id) => log.push(`landed:${id}`),
    toBelt: (id) => log.push(`toBelt:${id}`),
  };
  return { log, hooks };
}

const ptr = (pointerId: number, pointerType = 'mouse'): PointerInput => ({
  pointerId,
  clientX: 100 + pointerId,
  clientY: 200,
  pointerType,
});

let session: GameSession;
let view: FakeView;
let surface: FakeSurface;
let blur: FakeSurface;
let log: string[];
let ctl: InteractionController;

function board() {
  return JSON.stringify([session.placements, session.queue, session.evaluation]);
}

/** Picks `id`, aims at `target`, lets the controller show it, releases. */
function drag(id: number, target: DropTarget | null, pointerId = 1) {
  view.pick = id;
  ctl.down(ptr(pointerId));
  view.target = target;
  ctl.update();
  ctl.up(ptr(pointerId));
}

beforeEach(() => {
  session = new GameSession(TIP, { source: { mode: 'campaign', levelId: TIP.id } });
  view = new FakeView();
  surface = new FakeSurface();
  blur = new FakeSurface();
  const r = recorder();
  log = r.log;
  ctl = new InteractionController({ surface, session, view, hooks: r.hooks, blurTarget: blur });
  ctl.attach();
});

describe('InteractionController', () => {
  test('picking a package up only holds it: board and belt are untouched', () => {
    const before = board();
    view.pick = 0;
    ctl.down(ptr(1, 'touch'));
    assert.equal(session.held, 0);
    assert.equal(ctl.holding, 0);
    assert.equal(board(), before);
    assert.deepEqual(view.only('beginDrag'), ['beginDrag:0:touch']);
    assert.ok(surface.captured.has(1), 'the active pointer is captured');
    assert.deepEqual(log, ['grabbed:0']);
  });

  test('dragging the belt package onto a legal slot commits exactly one move', () => {
    view.pick = 0;
    ctl.down(ptr(1));
    view.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.update();
    assert.ok(view.calls.includes('ghost:0:2:1:ok'));
    assert.ok(log.includes('preview:0'));
    ctl.up(ptr(1));

    assert.deepEqual(session.placements, [{ id: 0, type: 'heavy', shelf: 0, slot: 2 }]);
    assert.deepEqual(session.queue, [1, 2]);
    assert.equal(session.held, null);
    assert.equal(session.rejectedDrops, 0);
    // endDrag, then the one transition, then the controller is told to sync.
    const endAt = view.calls.indexOf('endDrag');
    const placedAt = view.calls.indexOf('cargoPlaced:0:0:2:loud');
    assert.ok(endAt >= 0 && placedAt > endAt);
    assert.deepEqual(view.only('cargo'), ['cargoPlaced:0:0:2:loud']);
    assert.deepEqual(
      log.filter((l) => l.startsWith('placed') || l.startsWith('landed')),
      ['landed:0', 'placed:0:false'],
    );
    assert.equal(surface.captured.size, 0, 'capture released');
  });

  test('an illegal slot changes nothing, reports the reason and sends the package back', () => {
    session.move(0, 0, 2);
    const before = board();
    view.pick = 1;
    ctl.down(ptr(1));
    view.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.update();
    assert.ok(view.calls.includes('ghost:0:2:1:bad'));
    ctl.up(ptr(1));

    assert.equal(board(), before);
    assert.equal(session.held, null);
    assert.equal(session.rejectedDrops, 1, 'the refused drop is counted');
    assert.ok(log.includes('rejected:NO ROOM THERE'));
    assert.deepEqual(view.only('cargo'), ['cargoReturn:1']);
  });

  test('a second pointer is ignored while a package is in hand', () => {
    view.pick = 0;
    ctl.down(ptr(1));
    ctl.down(ptr(2));
    ctl.move(ptr(2));
    ctl.up(ptr(2));
    assert.deepEqual(view.only('beginDrag'), ['beginDrag:0:mouse']);
    assert.equal(view.only('moveDrag').length, 0);
    assert.equal(view.only('pick').length, 1, 'the second finger never even hit-tests');
    assert.equal(session.held, 0, 'still in hand after the second finger lifts');
    assert.equal(view.only('cargo').length, 0);

    ctl.move(ptr(1));
    assert.equal(view.only('moveDrag').length, 1);
    view.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.update();
    ctl.up(ptr(1));
    assert.deepEqual(session.placements.map((p) => p.id), [0]);
  });

  test('pointercancel mid-drag changes nothing and returns the package', () => {
    session.move(0, 0, 1);
    const before = board();
    view.pick = 0;
    ctl.down(ptr(1));
    view.target = { kind: 'slot', shelf: 0, slot: 3 };
    ctl.update();

    surface.emit('pointercancel', { pointerId: 7 });
    assert.equal(session.held, 0, 'a cancel for another pointer is ignored');

    surface.emit('pointercancel', { pointerId: 1 });
    assert.equal(board(), before);
    assert.equal(session.held, null);
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0']);
    assert.ok(view.calls.includes('endDrag'));
    assert.equal(surface.captured.size, 0);

    // The pointerup that follows the cancel does nothing.
    ctl.up(ptr(1));
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0']);
    assert.equal(board(), before);
  });

  test('losing pointer capture or window focus also puts the package back', () => {
    view.pick = 0;
    ctl.down(ptr(1));
    surface.emit('lostpointercapture', { pointerId: 1 });
    assert.equal(session.held, null);
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0']);

    ctl.down(ptr(2));
    blur.emit('blur');
    assert.equal(session.held, null);
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0', 'cargoReturn:0']);
    assert.deepEqual(session.queue, [0, 1, 2]);
  });

  test('holding the offending crate does not stop the hazard clock', () => {
    drag(0, { kind: 'slot', shelf: 0, slot: 4 });
    assert.equal(session.evaluation.status, 'danger');
    let r = session.advance(200);
    assert.equal(r.hazard.kind, 'balance');
    const left = r.hazard.remaining;

    view.pick = 0;
    ctl.down(ptr(3));
    view.target = null; // lifted clear of the rack
    ctl.update();
    assert.equal(session.held, 0);
    r = session.advance(300);
    assert.equal(r.hazard.kind, 'balance');
    assert.ok(r.hazard.remaining < left - 250, `clock kept draining (${left} -> ${r.hazard.remaining})`);
    assert.deepEqual(session.placements, [{ id: 0, type: 'heavy', shelf: 0, slot: 4 }]);

    // Still holding when the grace runs out: the shipment fails.
    for (let i = 0; i < 40 && !r.outcome; i++) r = session.advance(100);
    assert.equal(r.outcome?.result, 'failed');
    ctl.abort();
    const transitions = view.only('cargo').length;
    ctl.up(ptr(3));
    assert.equal(view.only('cargo').length, transitions, 'the pointerup after the outcome is ignored');
    assert.equal(ctl.holding, null);
  });

  test('release commits the target that was last shown, not a fresh hit-test', () => {
    view.pick = 0;
    ctl.down(ptr(1));
    view.target = { kind: 'slot', shelf: 0, slot: 1 };
    ctl.update();
    view.target = { kind: 'slot', shelf: 0, slot: 3 }; // moved, but no frame showed it yet
    ctl.up(ptr(1));
    assert.deepEqual(session.placements, [{ id: 0, type: 'heavy', shelf: 0, slot: 1 }]);
  });

  test('the belt: a stowed package goes back in one command, a belt package just returns', () => {
    session.move(0, 0, 2);
    drag(0, { kind: 'belt' });
    assert.deepEqual(session.queue, [0, 1, 2]);
    assert.equal(session.placements.length, 0);
    assert.deepEqual(view.only('cargo'), ['cargoToBelt:0']);
    assert.ok(log.includes('toBelt:0'));
    assert.ok(log.includes('beltHover:true') && log.includes('beltHover:false'));
    assert.ok(view.calls.includes('belt:true') && view.calls.includes('belt:false'));

    const before = board();
    drag(0, { kind: 'belt' });
    assert.equal(board(), before);
    assert.deepEqual(view.only('cargo'), ['cargoToBelt:0', 'cargoReturn:0']);
    assert.equal(session.held, null);
  });

  test('no target, or the package\'s own slot: nothing changes and it lands quietly', () => {
    session.move(0, 0, 2);
    const before = board();
    drag(0, null);
    drag(0, { kind: 'slot', shelf: 0, slot: 2 });
    assert.equal(board(), before);
    assert.equal(session.rejectedDrops, 0);
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0', 'cargoReturn:0']);
    assert.equal(log.filter((l) => l.startsWith('placed')).length, 0);
  });

  test('a window resize or orientation change mid-drag puts the package back', () => {
    const before = board();
    view.pick = 0;
    ctl.down(ptr(1));
    view.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.update();
    blur.emit('resize');
    assert.equal(session.held, null);
    assert.equal(ctl.holding, null);
    ctl.up(ptr(1)); // the release after the resize commits nothing
    assert.equal(board(), before);

    ctl.down(ptr(2));
    blur.emit('orientationchange');
    assert.equal(session.held, null);
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0', 'cargoReturn:0']);
    assert.equal(board(), before);
  });

  test('setView: a drag on the old view is put back there, later input goes to the new view', () => {
    const before = board();
    view.pick = 0;
    ctl.down(ptr(1));
    const next = new FakeView();
    ctl.setView(next);
    assert.equal(session.held, null);
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0'], 'the old view settled its package');
    ctl.up(ptr(1));
    assert.equal(board(), before);
    assert.equal(surface.count() > 0, true, 'the listeners stay on the surface');

    // The same pointer surface now drives the new view.
    next.pick = 0;
    ctl.down(ptr(3));
    next.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.update();
    ctl.up(ptr(3));
    assert.deepEqual(next.only('cargoPlaced'), ['cargoPlaced:0:0:2:loud']);
    assert.equal(view.only('cargoPlaced').length, 0);
    assert.deepEqual(session.placements.map((p) => [p.id, p.shelf, p.slot]), [[0, 0, 2]]);
  });

  test('nothing can be picked up while paused, and detach removes every listener', () => {
    session.pause();
    view.pick = 0;
    ctl.down(ptr(1));
    assert.equal(view.only('beginDrag').length, 0);
    assert.equal(session.held, null);

    assert.ok(surface.count() > 0 && blur.count() > 0);
    ctl.detach();
    assert.equal(surface.count(), 0);
    assert.equal(blur.count(), 0);
  });
});
