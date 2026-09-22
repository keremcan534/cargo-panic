/**
 * Dev harness for the Canvas 2D renderer, without the game controller.
 *
 * Serve with `npx vite --port 5199` and open
 *   /tests/harness/canvas2d.html?level=12
 *   /tests/harness/canvas2d.html?seed=12345&wave=25
 *   /tests/harness/canvas2d.html?view=menu        (or view=levels)
 * Extra params: rm=1 reduced motion, chrome=0 hides the DOM HUD, dev=0 hides
 * the key legend.
 *
 * It plays the same way the real controller will: a GameSession owns the
 * rules; pointer input goes view.pickCargo -> session.hold -> view.beginDrag;
 * every frame view.update -> view.dragTarget -> session.preview -> showGhost;
 * on release it commits the target it last showed (session.move / toBelt) and
 * follows the contract's order: command -> transition -> sync.
 *
 * Keys: c celebrate, d dispatch, x / X collapse right / left, o overload,
 * f fragile, h cycle highlight, i hint, s select live package, b belt hover,
 * u undo, p pause clocks, z reduced motion, r restart, n next level,
 * m menu backdrop, l levels backdrop, g back to the game.
 *
 * `window.__harness` exposes the session, view and stage for scripting, plus
 * freeze()/step() for deterministic screenshots.
 *
 * Not part of the production build (vite.config.ts only builds index.html).
 */

import '../../src/style.css';
import { getWave } from '../../src/game/levels/generator';
import { getLevel, TOTAL_LEVELS } from '../../src/game/levels/levels';
import { PACKAGE_SPECS } from '../../src/game/levels/types';
import type { LevelDef } from '../../src/game/levels/types';
import { GameSession, waveSource } from '../../src/game/session';
import type { ShipmentOutcome, ShipmentSource } from '../../src/game/session';
import { rejectionMessage } from '../../src/game/systems/BalanceSystem';
import type { PlaceRejection, Placement } from '../../src/game/systems/BalanceSystem';
import { newRun } from '../../src/game/systems/RunManager';
import { solve } from '../../src/game/systems/Solver';
import { Canvas2DStage } from '../../src/render/canvas2d/Canvas2DStage';
import type { BoardView, DropTarget, GameView, PointerSample, ViewHighlight } from '../../src/render/GameView';
import type { Backdrop } from '../../src/render/Stage';
import { Hud } from '../../src/ui/Hud';
import { Meter } from '../../src/ui/Meter';
import { btn, el, iconBtn } from '../../src/ui/dom';

type Source = { kind: 'campaign'; level: number } | { kind: 'endless'; seed: number; wave: number };

const q = new URLSearchParams(location.search);
const showChrome = q.get('chrome') !== '0';
const showDev = q.get('dev') !== '0';

const gameRoot = document.getElementById('game-root') as HTMLElement;
const ui = document.getElementById('ui-root') as HTMLElement;
const stage = new Canvas2DStage(gameRoot, {
  reducedMotion: q.get('rm') === '1',
  quality: 'auto',
});
const canvas = stage.canvas;

let source: Source = { kind: 'campaign', level: 1 };
let session: GameSession | null = null;
let view: GameView | null = null;
let backdrop: Backdrop | null = null;
let hud: Hud | null = null;
let meter: Meter | null = null;
let chrome: HTMLElement[] = [];
let clocks = true;
let running = true;
let drag: { pointerId: number; cargo: number } | null = null;
let shown: DropTarget | null = null;
let spotStep = 0;
let selected: number | null = null;
let beltHover = false;
const outcomes: string[] = [];
const events: string[] = [];

function boardView(): BoardView {
  const s = session as GameSession;
  return {
    level: s.level,
    queue: s.queue,
    placements: s.placements,
    evaluation: s.evaluation,
    held: s.held,
    wobble: s.evaluation.status === 'danger',
  };
}

function teardown() {
  drag = null;
  shown = null;
  selected = null;
  view?.dispose();
  view = null;
  backdrop?.dispose();
  backdrop = null;
  session = null;
  hud?.destroy();
  meter?.destroy();
  hud = null;
  meter = null;
  for (const e of chrome) e.remove();
  chrome = [];
}

function loadGame(src: Source) {
  teardown();
  source = src;
  let level: LevelDef;
  let graceScale = 1;
  let sessionSource: ShipmentSource;
  if (src.kind === 'campaign') {
    level = getLevel(src.level);
    sessionSource = { mode: 'campaign', levelId: level.id };
  } else {
    const plan = getWave(src.seed, src.wave);
    level = plan.level;
    graceScale = plan.graceScale;
    const run = newRun(src.seed);
    run.wave = src.wave;
    sessionSource = waveSource(run);
  }
  session = new GameSession(level, { source: sessionSource, graceScale, undoAllowance: 1 });
  view = stage.createGameView();
  view.mount(boardView());
  if (showChrome) {
    const endless = src.kind === 'endless';
    hud = new Hud(
      {
        title: endless ? `WAVE ${src.wave}` : `LEVEL ${level.id}`,
        subtitle: endless ? `SEED ${src.seed}` : level.name,
        subtitleGold: endless,
        objective: level.objective,
        showRestart: true,
      },
      { onRestart: () => loadGame(source), onPause: () => setClocks(!clocks) },
    );
    meter = new Meter(level.balanceTolerance);
    const controls = el('div', { class: 'controls' }, [
      iconBtn('help', () => undefined, 'Cargo guide'),
      el('div', { class: 'hint-text', text: 'Drag cargo onto a shelf.\nTap a stowed box to move it.' }),
      btn('HINT', () => hint(), 'gold', 'sm'),
    ]);
    (controls.querySelector('.hint-text') as HTMLElement).style.whiteSpace = 'pre-line';
    ui.append(controls);
    chrome.push(controls);
  }
  refreshHud();
}

function showBackdrop(kind: 'menu' | 'levels') {
  teardown();
  backdrop = stage.showBackdrop(kind);
  if (!showChrome) return;
  if (kind === 'menu') {
    const menu = el('div', { class: 'screen menu' }, [
      el('div', { class: 'top' }, [iconBtn('sound-on', () => undefined, 'Sound')]),
      el('div', { class: 'wordmark' }, [
        el('div', { class: 'l1', text: 'CARGO' }),
        el('div', { class: 'l2', text: 'PANIC' }),
        el('div', { class: 'tagline', text: 'PACK THE WAREHOUSE WITHOUT TIPPING THE SHELVES' }),
      ]),
      el('div', { class: 'bottom' }, [
        el('div', { class: 'chip' }, [
          el('span', { class: 'g', text: `★ 0 / ${TOTAL_LEVELS * 3}` }),
          el('span', { class: 'd', text: `0 / ${TOTAL_LEVELS} CLEARED` }),
        ]),
        btn('PLAY', () => loadGame({ kind: 'campaign', level: 1 }), 'primary', 'lg'),
        el('div', { class: 'caption', text: 'PROCEDURAL WAVES - ONE MISTAKE ENDS A RUN' }),
        btn('ENDLESS SHIFT', () => loadGame({ kind: 'endless', seed: 12345, wave: 1 }), 'gold', 'md'),
        btn('LEVEL SELECT', () => showBackdrop('levels'), 'secondary', 'md'),
        el('div', { class: 'studio', text: 'BLACKBLUE STUDIOS' }),
      ]),
    ]);
    ui.append(menu);
    chrome.push(menu);
  } else {
    const dim = el('div', { class: 'screen levels' }, [el('div', { class: 'dim-3d' })]);
    ui.append(dim);
    chrome.push(dim);
  }
}

function refreshHud() {
  if (!session) return;
  const ev = session.evaluation;
  meter?.setValue(ev.net, ev.leftTorque, ev.rightTorque, ev.status);
  hud?.setRemaining(session.remaining, session.level.packages.length);
  const block = session.blockReason();
  hud?.setObjective(block ? `BLOCKED: ${block.key.toUpperCase()}` : session.level.objective);
}

function setClocks(on: boolean) {
  clocks = on;
  events.push(on ? 'clocks on' : 'clocks off');
}

// ---------------------------------------------------------------------------
// Pointer input, the way the controller will do it
// ---------------------------------------------------------------------------

function sample(e: PointerEvent): PointerSample {
  return { clientX: e.clientX, clientY: e.clientY, touch: e.pointerType === 'touch' };
}

canvas.addEventListener('pointerdown', (e) => {
  if (drag || !session || !view || session.phase !== 'play') return;
  const p = sample(e);
  const id = view.pickCargo(p, session.movable());
  if (id === null || !session.hold(id)) return;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // Synthetic pointers may not be capturable; the drag still works.
  }
  drag = { pointerId: e.pointerId, cargo: id };
  view.beginDrag(id, p);
  view.sync(boardView());
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId || !view) return;
  view.moveDrag(sample(e));
});

canvas.addEventListener('pointerup', (e) => {
  if (drag && e.pointerId === drag.pointerId) finishDrag(true);
});
canvas.addEventListener('pointercancel', (e) => {
  if (drag && e.pointerId === drag.pointerId) finishDrag(false);
});
window.addEventListener('blur', () => finishDrag(false));

/** Per frame while dragging: the view resolves the target, the session judges it, the view shows it. */
function previewTarget() {
  if (!drag || !session || !view) return;
  const t = view.dragTarget();
  if (t && t.kind === 'slot') {
    const pv = session.preview(drag.cargo, t.shelf, t.slot);
    view.showGhost(t, PACKAGE_SPECS[session.level.packages[drag.cargo]].slots, pv.kind);
    view.setBeltHover(false);
    if (pv.evaluation) meter?.showPreview(pv.evaluation.net);
    else meter?.hidePreview();
  } else if (t && t.kind === 'belt') {
    view.hideGhost();
    view.setBeltHover(true);
    meter?.hidePreview();
  } else {
    view.hideGhost();
    view.setBeltHover(false);
    meter?.hidePreview();
  }
  shown = t;
}

function finishDrag(commit: boolean) {
  if (!drag || !session || !view) return;
  const id = drag.cargo;
  drag = null;
  const t = commit ? shown : null;
  shown = null;
  view.endDrag();
  meter?.hidePreview();
  if (t?.kind === 'slot') {
    const r = session.move(id, t.shelf, t.slot);
    if (r.ok) {
      view.cargoPlaced(id, { shelf: t.shelf, slot: t.slot }, { quiet: !r.changed });
      events.push(`move ${id} -> ${t.shelf}/${t.slot}`);
    } else {
      view.cargoReturn(id);
      const reason = r.rejection === 'not-playing' || r.rejection === 'not-movable' ? r.rejection : rejectionMessage(r.rejection as PlaceRejection);
      hud?.toast(reason);
      events.push(`refused ${id} -> ${t.shelf}/${t.slot}: ${r.rejection}`);
    }
  } else if (t?.kind === 'belt') {
    const r = session.toBelt(id);
    if (r.ok && r.changed) {
      view.cargoToBelt(id);
      hud?.toast('BACK ON THE BELT', 'info');
      events.push(`belt ${id}`);
    } else {
      view.cargoReturn(id);
    }
  } else {
    session.release(id);
    view.cargoReturn(id);
  }
  view.sync(boardView());
  refreshHud();
}

// ---------------------------------------------------------------------------
// Outcomes and manual triggers
// ---------------------------------------------------------------------------

function onOutcome(o: ShipmentOutcome) {
  if (!view || !session) return;
  drag = null;
  shown = null;
  hud?.hideHazard();
  outcomes.push(`${o.result}${o.failure ? `:${o.failure.kind}` : ''}`);
  if (o.result === 'won') {
    view.celebrate();
    if (source.kind === 'endless') {
      view.dispatch({
        onEach: (cargoId, i) => events.push(`dispatch ${cargoId} #${i}`),
        onDone: () => events.push('dispatched'),
      });
    }
    hud?.toast(source.kind === 'endless' ? 'WAVE CLEAR' : 'SHIPMENT COMPLETE', 'good');
    return;
  }
  const f = o.failure;
  if (!f) return;
  if (f.kind === 'balance') {
    view.failCollapse(f.net >= 0 ? 1 : -1);
  } else if (f.kind === 'overload') {
    view.failOverload(f.tier, session.evaluation.net >= 0 ? 1 : -1);
    view.highlight({ shelf: f.tier });
  } else {
    view.failFragile(f.fragileId);
    if (f.crusherIds.length) view.highlight({ cargo: f.crusherIds[0] });
  }
}

function hint() {
  if (!session || !view) return;
  const h = session.hint();
  const current = session.current;
  if (!h || h.kind === 'stuck' || current === null) {
    hud?.toast('NO HINT', 'info');
    return;
  }
  view.showHint(current, { shelf: h.shelf, slot: h.slot });
}

function stowedIds(): Placement[] {
  return session ? session.placements : [];
}

function cycleHighlight() {
  if (!view || !session) return;
  const tiers = session.level.shelves.length;
  const stowed = stowedIds();
  const options: ViewHighlight[] = [];
  for (let t = 0; t < tiers; t++) options.push({ shelf: t });
  if (stowed.length) options.push({ cargo: stowed[0].id });
  if (session.current !== null) options.push({ cargo: session.current });
  options.push(null);
  const h = options[spotStep % options.length];
  spotStep++;
  view.highlight(h);
}

window.addEventListener('keydown', (e) => {
  const v = view;
  const s = session;
  switch (e.key) {
    case 'c':
      v?.celebrate();
      break;
    case 'd':
      v?.dispatch({ onDone: () => events.push('dispatched') });
      break;
    case 'x':
      v?.failCollapse(1);
      break;
    case 'X':
      v?.failCollapse(-1);
      break;
    case 'o': {
      const top = stowedIds().reduce((m, p) => Math.max(m, p.shelf), 0);
      v?.failOverload(top, 1);
      v?.highlight({ shelf: top });
      break;
    }
    case 'f': {
      const frag = stowedIds().find((p) => p.type === 'fragile');
      if (frag) v?.failFragile(frag.id);
      break;
    }
    case 'h':
      cycleHighlight();
      break;
    case 'i':
      hint();
      break;
    case 's':
      selected = selected === null ? (s?.current ?? null) : null;
      v?.setSelected(selected);
      break;
    case 'b':
      beltHover = !beltHover;
      v?.setBeltHover(beltHover);
      break;
    case 'u':
      if (s?.undo() && v) {
        v.sync(boardView());
        refreshHud();
      }
      break;
    case 'p':
      setClocks(!clocks);
      break;
    case 'z':
      stage.setReducedMotion(!stage.reducedMotion);
      break;
    case 'r':
      if (session) loadGame(source);
      break;
    case 'n':
      if (source.kind === 'campaign') loadGame({ kind: 'campaign', level: Math.min(TOTAL_LEVELS, source.level + 1) });
      else loadGame({ ...source, wave: source.wave + 1 });
      break;
    case 'm':
      showBackdrop('menu');
      break;
    case 'l':
      showBackdrop('levels');
      break;
    case 'g':
      loadGame(source);
      break;
  }
});

// ---------------------------------------------------------------------------
// Frame loop (the app's FrameLoop does the same: tweens, updates, then render)
// ---------------------------------------------------------------------------

function step(animMs: number, realMs: number) {
  stage.tweens.update(animMs);
  const s = session;
  const v = view;
  if (s && v) {
    v.update(animMs);
    if (drag) previewTarget();
    if (clocks && s.phase === 'play') {
      const res = s.advance(realMs);
      const hz = res.hazard;
      if (hz.kind && !res.outcome) hud?.showHazard(hz.kind, hz.remaining, hz.total);
      else hud?.hideHazard();
      if (res.outcome) onOutcome(res.outcome);
    }
    meter?.tick(animMs);
  }
  stage.render(animMs);
}

let last = performance.now();
let frames = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const raw = Math.max(0, now - last);
  last = now;
  if (!running) return;
  frames++;
  step(Math.min(50, raw), Math.min(250, raw));
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const viewParam = q.get('view');
if (viewParam === 'menu' || viewParam === 'levels') {
  showBackdrop(viewParam);
} else if (q.has('seed') || q.has('wave')) {
  loadGame({ kind: 'endless', seed: Number(q.get('seed') ?? 12345) >>> 0, wave: Math.max(1, Number(q.get('wave') ?? 1)) });
} else {
  loadGame({ kind: 'campaign', level: Math.max(1, Math.min(TOTAL_LEVELS, Number(q.get('level') ?? 1))) });
}

if (showDev) {
  const legend = el('div', {
    text: 'c celebrate  d dispatch  x/X collapse  o overload  f fragile  h highlight  i hint  s select  b belt  u undo  p clocks  z motion  r restart  n next  m/l/g screens',
    style: {
      position: 'absolute',
      left: '4px',
      bottom: '2px',
      right: '4px',
      font: '10px monospace',
      color: '#5c6d84',
      pointerEvents: 'none',
      whiteSpace: 'normal',
    },
  });
  document.body.append(legend);
}

/** Conveyor-order solution: never red while placing if the solver can prove it, else any solution. */
function solution(): Placement[] {
  if (!session) return [];
  const level = session.level;
  const ids = level.packages.map((_, i) => i);
  const ordered = solve(level, [], ids, { prefixLimit: level.balanceTolerance });
  const res = ordered.ok ? ordered : solve(level, [], ids);
  const byId = new Map(res.placements.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is Placement => !!p);
}

const harness = {
  get session() {
    return session;
  },
  get view() {
    return view;
  },
  stage,
  boardView,
  outcomes,
  events,
  get frames() {
    return frames;
  },
  get dragging() {
    return drag !== null;
  },
  get clocks() {
    return clocks;
  },
  load(src: Source) {
    loadGame(src);
  },
  menu() {
    showBackdrop('menu');
  },
  levels() {
    showBackdrop('levels');
  },
  setClocks,
  /** Stops the rAF-driven steps; use step() to advance deterministically. */
  freeze() {
    running = false;
  },
  resume() {
    last = performance.now();
    running = true;
  },
  step(ms = 16, count = 1) {
    for (let i = 0; i < count; i++) step(ms, ms);
  },
  solution,
  clientPointOf(target: Parameters<GameView['clientPointOf']>[0]) {
    return view?.clientPointOf(target) ?? null;
  },
  keys: {
    celebrate: () => view?.celebrate(),
    dispatch: () => view?.dispatch({ onDone: () => events.push('dispatched') }),
    failCollapse: (dir = 1) => view?.failCollapse(dir),
    failOverload: (tier: number, dir = 1) => view?.failOverload(tier, dir),
    failFragile: (id: number) => view?.failFragile(id),
    highlight: (h: ViewHighlight) => view?.highlight(h),
    showHint: () => hint(),
    setSelected: (id: number | null) => view?.setSelected(id),
  },
};

(window as unknown as { __harness: typeof harness }).__harness = harness;
