/**
 * The game board in Canvas 2D: a clean front view of the same rack, belt and
 * cargo the 3D view shows, driven by the same GameView calls.
 *
 * Like every GameView it only draws and maps pointers to semantic targets.
 * Slot hit-testing goes through layout2d / render/layout.ts (the formulas the
 * 3D rack uses): a drag resolves from the package's drawn centre (slot first,
 * the belt only over no slot), a tap from the point (belt band first). It
 * never decides whether a move is legal.
 *
 * World units match the 3D world (1 slot = 1 unit, floor y = 0, y up). Each
 * package lives either in rack space (it leans with the rack) or in world
 * space (belt, hand, falling), and moves between them keeping its on-screen
 * position, like re-parenting a mesh in the 3D scene.
 *
 * Timing, easing and effect sizes mirror the 3D view (Rack3D, Shelf3D,
 * Cargo3D, Conveyor3D and the old controller's spill / dispatch code).
 */

import { CRUSH_WEIGHT, W3 } from '../../game/config';
import { PACKAGE_SPECS } from '../../game/levels/types';
import type { LevelDef, PackageType } from '../../game/levels/types';
import type { TargetKind } from '../../game/session/types';
import type {
  BoardView,
  ClientPoint,
  DispatchCallbacks,
  DropTarget,
  GameView,
  PointerSample,
  ViewHighlight,
} from '../GameView';
import { Easing } from '../Tween';
import { bakeWarehouse } from './backdrops2d';
import {
  BELT_2D,
  cargoCentreY,
  dragTargetFromLocal,
  layout2d,
  shelfSurfaceY,
  slotCentreX,
  tapTargetFromLocal,
  tiltFor,
  toScreen,
  toWorld,
} from './layout2d';
import type { Layout2D, Point } from './layout2d';
import { leanOffset, rackToWorld, worldToRack } from './lean2d';
import { RackArt2D } from './rack2d';
import type { CrushColumn } from './rack2d';
import { bakeCargoSprite, bakeGlow, drawIcon, freeCanvas, hatch, makeCanvas } from './sprites2d';
import type { CargoSprite, IconKind } from './sprites2d';
import type { Host2D, Layer2D } from './types2d';
import type { Burst2D } from './Particles2D';
import { roundRect } from '../art/cargoArt';

const DEG = Math.PI / 180;
/** Conveyor3D belt speeds, world units per second. */
const BELT_SPEED = 0.35;
const BELT_SPEED_DRAG = 0.08;
/** How long a hint stays up (the old controller's timer). */
const HINT_MS = 4200;
/** Visual lift of a tap-selected package. */
const SELECT_LIFT = 0.12;

const GHOST: Record<TargetKind | 'hint', { line: string; fill: string; pattern: string; icon: IconKind }> = {
  ok: { line: '#3fd68a', fill: 'rgba(63,214,138,0.22)', pattern: '', icon: 'ok' },
  crush: { line: '#f5c451', fill: 'rgba(245,196,81,0.2)', pattern: 'rgba(245,196,81,0.5)', icon: 'crush' },
  bad: { line: '#ff5f57', fill: 'rgba(255,95,87,0.2)', pattern: 'rgba(255,95,87,0.55)', icon: 'bad' },
  hint: { line: '#ffc93c', fill: 'rgba(255,201,60,0.18)', pattern: '', icon: 'hint' },
};

const DASH_CRUSH = [7, 4];
const DASH_HELD = [5, 4];
const DASH_CELL = [3, 3];
const NO_DASH: number[] = [];

/** Emission caps under reduced motion: a token puff, no storms. */
const TOKEN: Record<Burst2D, number> = { dust: 2, spark: 2, glass: 4, debris: 2, confetti: 6, glint: 1 };

/** Sprite-cache keys for cracked faces (no string building per frame). */
const CRACKED_KEY: Record<PackageType, string> = {
  standard: 'standard!',
  heavy: 'heavy!',
  fragile: 'fragile!',
  long: 'long!',
  priority: 'priority!',
};

type Loc = { at: 'shelf'; shelf: number; slot: number } | { at: 'belt'; index: number } | { at: 'none' };
const NOWHERE: Loc = { at: 'none' };

/**
 * rest    - at its board location (or tweening there after a sync)
 * hand    - being dragged
 * loose   - drag ended, waiting for the controller's transition call
 * moving  - a transition (cargoPlaced / cargoToBelt / cargoReturn) owns it
 * falling - spilled off the rack
 * gone    - dispatched or shattered
 */
type Mode = 'rest' | 'hand' | 'loose' | 'moving' | 'falling' | 'gone';

class Box {
  readonly slots: number;
  readonly weight: number;
  /** Box width in world units. */
  readonly w: number;
  space: 'rack' | 'world' = 'world';
  /** Centre, in `space`. */
  readonly p = { x: 0, y: 0 };
  /** Own rotation (radians, counter-clockwise). */
  readonly r = { v: 0 };
  /** Uniform scale: 0.86 queued, 1.07 in hand. */
  readonly k = { v: 1 };
  /** Squash and stretch about the base. */
  readonly sq = { x: 1, y: 1 };
  readonly a = { v: 1 };
  mode: Mode = 'rest';
  loc: Loc = NOWHERE;
  visible = false;
  cracked = false;
  vx = 0;
  vy = 0;
  spin = 0;
  settled = false;
  fallDelay = 0;

  constructor(
    readonly id: number,
    readonly type: PackageType,
  ) {
    const spec = PACKAGE_SPECS[type];
    this.slots = spec.slots;
    this.weight = spec.weight;
    this.w = spec.slots * W3.slot - W3.cargoGap;
  }
}

interface Drag {
  box: Box;
  gx: number;
  gy: number;
  lift: number;
  liftTarget: number;
  /** Pointer in world units. */
  px: number;
  py: number;
  /** Where the package was when it was picked up. */
  origin: Loc;
}

function sameLoc(a: Loc, b: Loc): boolean {
  if (a.at !== b.at) return false;
  if (a.at === 'shelf' && b.at === 'shelf') return a.shelf === b.shelf && a.slot === b.slot;
  if (a.at === 'belt' && b.at === 'belt') return a.index === b.index;
  return true;
}

function locOf(board: BoardView, id: number): Loc {
  for (const p of board.placements) if (p.id === id) return { at: 'shelf', shelf: p.shelf, slot: p.slot };
  const index = board.queue.indexOf(id);
  return index >= 0 ? { at: 'belt', index } : NOWHERE;
}

export class Canvas2DGameView implements GameView, Layer2D {
  readonly mode = '2d' as const;

  private level: LevelDef | null = null;
  private board: BoardView | null = null;
  private boxes: Box[] = [];

  // Frame and baked art.
  private width = 1;
  private height = 1;
  private dpr = 1;
  private L: Layout2D | null = null;
  private bg: HTMLCanvasElement | null = null;
  private rack: RackArt2D | null = null;
  private sprites = new Map<string, CargoSprite>();
  private beltBody: HTMLCanvasElement | null = null;
  private beltStrip: HTMLCanvasElement | null = null;
  private shadow: HTMLCanvasElement | null = null;

  // Rack.
  private rackState = { tilt: 0, pop: 1 };
  private tiltTarget = 0;
  private wobble = false;
  private wobblePhase = 0;
  private collapsing = false;
  private flex: { v: number }[] = [];
  private overloaded: boolean[] = [];
  private glowAlpha = new Float32Array(0);
  private loads: number[] = [];
  private columns: CrushColumn[] = [];
  private zoneEmpty: boolean[] = [];
  private emphasise = false;

  // Belt.
  private beltScroll = 0;
  private beltSpeed = BELT_SPEED;
  private beltHover = false;

  // Input and feedback.
  private drag: Drag | null = null;
  private target: DropTarget | null = null;
  private ghost: { shelf: number; slot: number; slots: number; kind: TargetKind } | null = null;
  private selected: number | null = null;
  private selectLift = 0;
  private hint: { id: number; shelf: number; slot: number; slots: number } | null = null;
  private hintLeft = 0;
  private spot: ViewHighlight = null;

  // Outcome.
  /** An outcome ran: transitions are no-ops from here on. */
  private ended = false;
  /** Placements from sync are ignored (after dispatch or a failure). */
  private frozen = false;
  private dispatched = false;

  // Clocks and effects.
  private time = 0;
  private shakeAmp = 0;
  private shakeLeft = 0;
  private shakeSeed = 0;
  private shakeX = 0;
  private shakeY = 0;
  private timers: (() => void)[] = [];
  private disposed = false;

  constructor(private host: Host2D) {
    host.attach(this);
  }

  // ==========================================================================
  // Layer2D
  // ==========================================================================

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    if (this.level) this.rebuild();
  }

  /** Re-lays out and re-bakes everything size-dependent. Positions are world units, so nothing moves. */
  private rebuild() {
    const level = this.level;
    if (!level) return;
    this.freeArt();
    const tiers = level.shelves.length;
    const maxSlots = Math.max(...level.shelves.map((s) => s.slots));
    const L = layout2d(this.width, this.height, tiers, maxSlots);
    this.L = L;
    const s = L.scale;
    this.bg = bakeWarehouse({
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      scale: s,
      originX: L.originX,
      floorY: L.floorY,
      halfWidth: L.halfWidth,
      rackTop: L.rackTop,
      lampY: this.height * 0.035,
      pool: true,
    });
    this.rack = new RackArt2D(level, s, this.dpr);
    this.loads.forEach((load, t) => this.rack?.setLoad(t, load));
    this.bakeBelt();
    this.shadow = bakeGlow('0,0,0', 64);
  }

  private freeArt() {
    freeCanvas(this.bg);
    this.bg = null;
    this.rack?.dispose();
    this.rack = null;
    for (const spr of this.sprites.values()) freeCanvas(spr.canvas);
    this.sprites.clear();
    freeCanvas(this.beltBody);
    freeCanvas(this.beltStrip);
    freeCanvas(this.shadow);
    this.beltBody = null;
    this.beltStrip = null;
    this.shadow = null;
  }

  private sprite(type: PackageType, cracked: boolean): CargoSprite {
    const key = cracked ? CRACKED_KEY[type] : type;
    let spr = this.sprites.get(key);
    if (!spr) {
      spr = bakeCargoSprite(this.host.art, type, cracked, this.L?.scale ?? 40, this.dpr);
      this.sprites.set(key, spr);
    }
    return spr;
  }

  // ==========================================================================
  // GameView: lifecycle
  // ==========================================================================

  mount(board: BoardView) {
    this.reset();
    this.ended = false;
    this.frozen = false;
    this.dispatched = false;
    this.collapsing = false;
    const level = board.level;
    this.level = level;
    this.board = board;
    this.boxes = level.packages.map((type, id) => new Box(id, type));
    this.flex = level.shelves.map(() => ({ v: 0 }));
    this.overloaded = level.shelves.map(() => false);
    this.glowAlpha = new Float32Array(level.shelves.length);
    this.loads = level.shelves.map(() => 0);
    this.zoneEmpty = level.shelves.map(() => true);
    this.rebuild();
    this.derive(board);
    this.rackState.tilt = this.tiltTarget;
    this.rackState.pop = 1;
    for (const box of this.boxes) this.settle(box, locOf(board, box.id), false);
  }

  sync(board: BoardView) {
    if (!this.level || board.level !== this.level) {
      this.mount(board);
      return;
    }
    this.board = board;
    this.derive(board);
    if (this.frozen) return;
    for (const box of this.boxes) {
      if (box.mode === 'hand' || box.mode === 'moving' || box.mode === 'falling' || box.mode === 'gone') continue;
      // A package whose drag ended with no transition call yet stays put while the session still holds it.
      if (box.mode === 'loose' && board.held === box.id) continue;
      const loc = locOf(board, box.id);
      if (box.mode === 'loose' || !sameLoc(box.loc, loc)) this.settle(box, loc, true);
    }
  }

  /** Board-derived visuals: lean, wobble, labels, overload glow, cracks, crush columns. */
  private derive(board: BoardView) {
    const level = this.level;
    if (!level) return;
    const ev = board.evaluation;
    if (this.dispatched) {
      this.tiltTarget = 0;
      this.wobble = false;
      for (let t = 0; t < level.shelves.length; t++) this.setLoad(t, 0);
      this.overloaded.fill(false);
      this.columns = [];
      return;
    }
    if (!this.collapsing) this.tiltTarget = tiltFor(ev.net, level.balanceTolerance);
    this.wobble = !this.frozen && board.wobble;
    for (let t = 0; t < level.shelves.length; t++) {
      this.setLoad(t, ev.shelfWeights[t] ?? 0);
      this.overloaded[t] = ev.overloaded.includes(t);
    }
    if (this.frozen) return;
    for (let t = 0; t < level.shelves.length; t++) {
      const z = level.shelves[t].zone;
      this.zoneEmpty[t] = !z || !board.placements.some((p) => p.shelf === t && p.slot < z.to && p.slot + PACKAGE_SPECS[p.type].slots > z.from);
    }
    for (const box of this.boxes) if (box.type === 'fragile') box.cracked = ev.crushed.includes(box.id);
    const cols: CrushColumn[] = [];
    const top = level.shelves.length - 1;
    for (const p of board.placements) {
      if (p.type !== 'fragile' || p.shelf >= top) continue;
      const slots = PACKAGE_SPECS[p.type].slots;
      const w = slots * W3.slot - 0.14;
      const cx = slotCentreX(level.shelves[p.shelf].slots, p.slot, slots);
      cols.push({ x: cx - w / 2, w, bottom: shelfSurfaceY(p.shelf) + W3.cargoH, top: (this.L?.rackTop ?? 0) - 0.2 });
    }
    this.columns = cols;
  }

  private setLoad(t: number, load: number) {
    this.loads[t] = load;
    this.rack?.setLoad(t, load);
  }

  update(dtMs: number) {
    if (!this.level) return;
    const dt = Math.max(0, dtMs);
    this.time += dt;
    const reduced = this.host.reducedMotion;

    // Lean, eased like Rack3D.tick, with the danger wobble on top.
    if (!this.collapsing) {
      const k = 1 - Math.pow(0.0015, dt / 1000);
      let target = this.tiltTarget;
      if (this.wobble && !reduced) {
        this.wobblePhase += dt / 1000;
        target += Math.sin(this.wobblePhase * 11) * 0.55 * DEG;
      }
      this.rackState.tilt += (target - this.rackState.tilt) * k;
    }

    // The belt creeps toward the pickup; under reduced motion it stands still.
    if (!reduced) this.beltScroll += (this.beltSpeed * dt) / 1000;

    const d = this.drag;
    if (d) {
      const k = 1 - Math.pow(0.0004, dt / 1000);
      d.lift += (d.liftTarget - d.lift) * k;
      d.box.p.x = d.px + d.gx;
      d.box.p.y = d.py + d.gy + d.lift;
      this.target = this.computeTarget();
    }

    this.updateFalling(dt);

    const ks = 1 - Math.pow(0.002, dt / 1000);
    this.selectLift += ((this.selected !== null ? SELECT_LIFT : 0) - this.selectLift) * ks;

    for (let t = 0; t < this.glowAlpha.length; t++) {
      this.glowAlpha[t] = this.overloaded[t]
        ? reduced
          ? 0.5
          : 0.55 * (0.5 - 0.5 * Math.cos((this.time / 600) * Math.PI * 2))
        : 0;
    }

    if (this.shakeLeft > 0 && !reduced) {
      this.shakeLeft -= dt;
      const s = this.L?.scale ?? 0;
      const amp = this.shakeAmp * Math.min(1, Math.max(0, this.shakeLeft / 1000) * 3) * s;
      this.shakeSeed += dt * 0.054;
      this.shakeX = Math.sin(this.shakeSeed * 7.1) * amp;
      this.shakeY = Math.cos(this.shakeSeed * 5.3) * amp * 0.7;
    } else {
      this.shakeLeft = 0;
      this.shakeAmp = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }

    if (this.hint) {
      this.hintLeft -= dt;
      if (this.hintLeft <= 0) this.clearHint();
    }
  }

  /** Spilled cargo: the old controller's tiny deterministic tumble, no physics engine. */
  private updateFalling(dt: number) {
    const s = dt / 1000;
    const floor = W3.cargoH / 2 + 0.02;
    for (const box of this.boxes) {
      if (box.mode !== 'falling' || box.settled) continue;
      if (box.fallDelay > 0) {
        box.fallDelay -= dt;
        continue;
      }
      box.vy -= 14 * s;
      box.p.x += box.vx * s;
      box.p.y += box.vy * s;
      box.r.v += box.spin * s;
      if (box.p.y <= floor) {
        box.p.y = floor;
        if (Math.abs(box.vy) > 1.2) {
          box.vy = -box.vy * 0.32;
          box.vx *= 0.6;
          box.spin *= 0.5;
          this.emit('debris', box.p.x, 0.05, 5);
          this.emit('dust', box.p.x, 0.05, 5);
        } else {
          box.settled = true;
          box.vx = 0;
          box.vy = 0;
          box.r.v = Math.round(box.r.v / (Math.PI / 2)) * (Math.PI / 2);
        }
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    this.host.detach(this);
    this.freeArt();
    this.boxes = [];
    this.board = null;
    this.level = null;
    this.L = null;
  }

  /** Stops every tween, timer and effect this view started. */
  private reset() {
    const tw = this.host.tweens;
    for (const box of this.boxes) {
      tw.kill(box.p);
      tw.kill(box.r);
      tw.kill(box.k);
      tw.kill(box.sq);
      tw.kill(box.a);
    }
    tw.kill(this.rackState);
    for (const f of this.flex) tw.kill(f);
    for (const cancel of this.timers) cancel();
    this.timers = [];
    this.host.particles.clear();
    this.drag = null;
    this.target = null;
    this.ghost = null;
    this.hint = null;
    this.spot = null;
    this.selected = null;
    this.selectLift = 0;
    this.beltHover = false;
    this.beltSpeed = BELT_SPEED;
    this.emphasise = false;
    this.shakeLeft = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.wobblePhase = 0;
  }

  private after(ms: number, fn: () => void) {
    this.timers.push(this.host.tweens.delay(ms, fn));
  }

  // ==========================================================================
  // Space conversions
  // ==========================================================================

  private get tilt() {
    return this.rackState.tilt;
  }

  /** World -> rack-local through the current lean (see lean2d: the rack leans on its low-side foot). */
  private toRack(p: Point): Point {
    return worldToRack(p, this.rackState.tilt, this.L?.halfWidth ?? 0);
  }

  private fromRack(p: Point): Point {
    return rackToWorld(p, this.rackState.tilt, this.L?.halfWidth ?? 0);
  }

  /** Moves a package into rack space keeping where it is on screen. */
  private attach(box: Box) {
    if (box.space === 'rack') return;
    const local = this.toRack(box.p);
    box.p.x = local.x;
    box.p.y = local.y;
    box.r.v -= this.tilt;
    box.space = 'rack';
  }

  /** Moves a package into world space keeping where it is on screen. */
  private detach(box: Box) {
    if (box.space === 'world') return;
    const world = this.fromRack(box.p);
    box.p.x = world.x;
    box.p.y = world.y;
    box.r.v += this.tilt;
    box.space = 'world';
  }

  private worldCentre(box: Box): Point {
    return box.space === 'rack' ? this.fromRack(box.p) : { x: box.p.x, y: box.p.y };
  }

  private pointerWorld(p: PointerSample): Point {
    const L = this.L;
    if (!L) return { x: 0, y: 0 };
    const rect = this.host.canvas.getBoundingClientRect();
    const sx = rect.width > 0 ? L.width / rect.width : 1;
    const sy = rect.height > 0 ? L.height / rect.height : 1;
    return toWorld(L, (p.clientX - rect.left) * sx, (p.clientY - rect.top) * sy);
  }

  // ==========================================================================
  // Placing packages
  // ==========================================================================

  /** Puts a package at a board location, instantly or with a short tween and a quiet landing. */
  private settle(box: Box, loc: Loc, animate: boolean) {
    const L = this.L;
    const level = this.level;
    if (!L || !level) return;
    const tw = this.host.tweens;
    tw.kill(box.p);
    tw.kill(box.k);
    tw.kill(box.a);
    box.mode = 'rest';
    box.loc = loc;
    box.sq.x = 1;
    box.sq.y = 1;
    const fast = this.host.reducedMotion ? 0.7 : 1;

    if (loc.at === 'shelf') {
      const def = level.shelves[loc.shelf];
      if (!def) return;
      this.attach(box);
      const tx = slotCentreX(def.slots, loc.slot, box.slots);
      const ty = cargoCentreY(loc.shelf);
      const wasVisible = box.visible;
      box.visible = true;
      if (!animate || !wasVisible) {
        box.p.x = tx;
        box.p.y = ty;
        box.r.v = 0;
        box.k.v = 1;
        box.a.v = 1;
        return;
      }
      tw.add(box.p, { x: tx, y: ty }, {
        ms: 180 * fast,
        ease: Easing.quadOut,
        onDone: () => this.land(box, loc.shelf, true),
      });
      tw.add(box.r, { v: 0 }, { ms: 180 * fast });
      tw.add(box.k, { v: 1 }, { ms: 180 * fast });
      tw.add(box.a, { v: 1 }, { ms: 120 });
      return;
    }

    if (loc.at === 'belt') {
      this.detach(box);
      const i = loc.index;
      const hiddenX = L.queueX[1] + 2.2;
      if (i > 2) {
        box.visible = false;
        box.p.x = hiddenX;
        box.p.y = BELT_2D.topY + (W3.cargoH * BELT_2D.queuedScale) / 2;
        box.k.v = BELT_2D.queuedScale;
        box.a.v = 0;
        box.r.v = 0;
        return;
      }
      const k = i === 0 ? 1 : BELT_2D.queuedScale;
      const alpha = i === 0 ? 1 : 0.62;
      const tx = i === 0 ? L.liveX : L.queueX[i - 1];
      const ty = BELT_2D.topY + (W3.cargoH * k) / 2;
      if (!box.visible && animate) {
        // Newly in view: roll in from the right, fading up.
        box.p.x = hiddenX;
        box.p.y = BELT_2D.topY + (W3.cargoH * BELT_2D.queuedScale) / 2;
        box.k.v = BELT_2D.queuedScale;
        box.a.v = 0;
      }
      box.visible = true;
      if (!animate) {
        box.p.x = tx;
        box.p.y = ty;
        box.k.v = k;
        box.a.v = alpha;
        box.r.v = 0;
        return;
      }
      tw.add(box.p, { x: tx, y: ty }, { ms: (i === 0 ? 320 : 280) * fast, ease: i === 0 ? Easing.backOut : Easing.quadOut });
      tw.add(box.k, { v: k }, { ms: 280 * fast });
      tw.add(box.a, { v: alpha }, { ms: 280 * fast });
      tw.add(box.r, { v: 0 }, { ms: 200 * fast });
      return;
    }

    box.visible = false;
  }

  /** After a transition, the package follows wherever the latest board says it is. */
  private settleLatest(box: Box) {
    if (this.frozen || !this.board || box.mode !== 'rest') return;
    const loc = locOf(this.board, box.id);
    if (!sameLoc(box.loc, loc)) this.settle(box, loc, true);
  }

  /** Touchdown: squash-and-stretch, plank flex, and (unless quiet) dust, sparks, glint, shake. */
  private land(box: Box, tier: number, quiet: boolean) {
    const tw = this.host.tweens;
    const reduced = this.host.reducedMotion;
    // Cargo3D.landBounce: heavier cargo squashes harder.
    tw.kill(box.sq);
    box.sq.x = 1;
    box.sq.y = 1;
    const sq = Math.min(0.28, 0.1 + box.weight * 0.035) * (reduced ? 0.4 : 1);
    const f = reduced ? 0.6 : 1;
    tw.add(box.sq, { x: 1 + sq, y: 1 - sq }, {
      ms: 80 * f,
      ease: Easing.quadOut,
      onDone: () =>
        tw.add(box.sq, { x: 1 - sq * 0.4, y: 1 + sq * 0.4 }, {
          ms: 90 * f,
          ease: Easing.quadInOut,
          onDone: () => tw.add(box.sq, { x: 1, y: 1 }, { ms: 130 * f, ease: Easing.backOut }),
        }),
    });
    // Shelf3D.flex.
    const fl = this.flex[tier];
    if (fl) {
      tw.kill(fl);
      fl.v = 0;
      tw.add(fl, { v: -Math.min(0.06, 0.012 * box.weight) }, {
        ms: 80,
        yoyo: true,
        ease: Easing.quadOut,
        onDone: () => {
          fl.v = 0;
        },
      });
    }
    if (quiet || box.space !== 'rack') return;
    const base = this.fromRack({ x: box.p.x, y: box.p.y - W3.cargoH / 2 });
    this.emit('dust', base.x, base.y, 5 + box.weight);
    if (box.type === 'heavy') {
      this.shake(0.06, 160);
      this.emit('spark', base.x, base.y, 6);
    } else if (box.type === 'fragile') {
      const top = this.fromRack({ x: box.p.x + box.w * 0.25, y: box.p.y + W3.cargoH * 0.35 });
      this.emit('glint', top.x, top.y, 2);
    }
  }

  private emit(kind: Burst2D, x: number, y: number, count: number) {
    const n = this.host.reducedMotion ? Math.min(count, TOKEN[kind]) : count;
    this.host.particles.emit(kind, x, y, n);
  }

  private shake(amplitude: number, ms: number) {
    if (this.host.reducedMotion) return;
    this.shakeAmp = Math.max(this.shakeAmp, amplitude);
    this.shakeLeft = Math.max(this.shakeLeft, ms);
  }

  // ==========================================================================
  // GameView: pointer -> semantic target
  // ==========================================================================

  pickCargo(p: PointerSample, candidates: readonly number[]): number | null {
    if (!this.L) return null;
    const pw = this.pointerWorld(p);
    const local = this.toRack(pw);
    const pad = p.touch ? 0.12 : 0;
    let best: number | null = null;
    let bestScore = Infinity;
    for (const id of candidates) {
      const box = this.boxes[id];
      if (!box || !box.visible || box.a.v < 0.05) continue;
      if (box.mode === 'hand' || box.mode === 'falling' || box.mode === 'gone') continue;
      const pt = box.space === 'rack' ? local : pw;
      const hw = (box.w * box.k.v) / 2;
      const hh = (W3.cargoH * box.k.v) / 2;
      const dx = Math.abs(pt.x - box.p.x);
      const dy = Math.abs(pt.y - box.p.y);
      if (dx > hw + pad || dy > hh + pad) continue;
      // A direct hit beats a near miss inside the touch margin; then the nearest centre wins.
      const score = (dx <= hw && dy <= hh ? 0 : 10) + dx / hw + dy / hh;
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  beginDrag(cargoId: number, p: PointerSample) {
    if (this.ended || !this.L) return;
    const box = this.boxes[cargoId];
    if (!box) return;
    if (this.drag && this.drag.box !== box) this.endDrag();
    this.clearHint();
    const tw = this.host.tweens;
    tw.kill(box.p);
    tw.kill(box.r);
    tw.kill(box.a);
    tw.kill(box.sq);
    const origin = box.loc;
    this.detach(box);
    box.mode = 'hand';
    box.visible = true;
    box.a.v = 1;
    box.sq.x = 1;
    box.sq.y = 1;
    tw.add(box.r, { v: 0 }, { ms: 140 });
    tw.kill(box.k);
    tw.add(box.k, { v: 1.07 }, { ms: 120, ease: Easing.backOut });

    const pw = this.pointerWorld(p);
    // Grab offset, clamped like the 3D controller: far off-centre snaps to the middle.
    let gx = box.p.x - pw.x;
    if (Math.abs(gx) > box.w * 0.4) gx = 0;
    const gy = Math.max(-W3.cargoH / 2, Math.min(W3.cargoH / 2, box.p.y - pw.y));
    this.drag = {
      box,
      gx,
      gy,
      lift: 0,
      liftTarget: p.touch ? W3.touchLift : 0,
      px: pw.x,
      py: pw.y,
      origin,
    };
    this.beltSpeed = BELT_SPEED_DRAG;
    this.emphasise = box.weight >= CRUSH_WEIGHT;
    this.target = this.computeTarget();
  }

  moveDrag(p: PointerSample) {
    const d = this.drag;
    if (!d) return;
    const pw = this.pointerWorld(p);
    d.px = pw.x;
    d.py = pw.y;
  }

  /** From the package's drawn centre (after lift and grab offset): a slot wins, the belt only over no slot. */
  private computeTarget(): DropTarget | null {
    const d = this.drag;
    const level = this.level;
    if (!d || !level) return null;
    return dragTargetFromLocal(level, this.toRack(d.box.p), d.box.p, d.box.slots);
  }

  dragTarget(): DropTarget | null {
    return this.target;
  }

  targetAt(p: PointerSample, slots: number): DropTarget | null {
    const level = this.level;
    if (!level || !this.L) return null;
    const pw = this.pointerWorld(p);
    return tapTargetFromLocal(level, this.toRack(pw), pw, slots);
  }

  endDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.target = null;
    this.ghost = null;
    this.beltHover = false;
    this.beltSpeed = BELT_SPEED;
    this.emphasise = false;
    d.box.mode = 'loose';
    const tw = this.host.tweens;
    tw.kill(d.box.k);
    tw.add(d.box.k, { v: 1 }, { ms: 120, ease: Easing.backOut });
  }

  // ==========================================================================
  // GameView: feedback
  // ==========================================================================

  showGhost(target: { shelf: number; slot: number }, slots: number, kind: TargetKind) {
    if (!this.level?.shelves[target.shelf]) {
      this.ghost = null;
      return;
    }
    this.ghost = { shelf: target.shelf, slot: target.slot, slots, kind };
  }

  hideGhost() {
    this.ghost = null;
  }

  setBeltHover(on: boolean) {
    this.beltHover = on;
  }

  setSelected(cargoId: number | null) {
    this.selected = cargoId !== null && this.boxes[cargoId] ? cargoId : null;
  }

  showHint(cargoId: number, target: { shelf: number; slot: number }) {
    const box = this.boxes[cargoId];
    if (!box || !this.level?.shelves[target.shelf]) return;
    this.hint = { id: cargoId, shelf: target.shelf, slot: target.slot, slots: box.slots };
    this.hintLeft = HINT_MS;
  }

  clearHint() {
    this.hint = null;
    this.hintLeft = 0;
  }

  highlight(h: ViewHighlight) {
    this.spot = h;
  }

  // ==========================================================================
  // GameView: transitions
  // ==========================================================================

  cargoPlaced(cargoId: number, target: { shelf: number; slot: number }, opts: { quiet: boolean; onLanded?: () => void }) {
    if (this.ended) return;
    const box = this.boxes[cargoId];
    const def = this.level?.shelves[target.shelf];
    if (!box || !def) return;
    if (this.drag?.box === box) this.endDrag();
    const tw = this.host.tweens;
    tw.kill(box.p);
    tw.kill(box.r);
    tw.kill(box.a);
    this.attach(box);
    box.mode = 'moving';
    box.visible = true;
    box.a.v = 1;
    const tx = slotCentreX(def.slots, target.slot, box.slots);
    const ty = cargoCentreY(target.shelf);
    // The 3D drop also crosses the drag plane's depth; count it so the timing matches.
    const dist = Math.hypot(box.p.x - tx, box.p.y - ty, opts.quiet ? 0 : W3.dragZ);
    const fast = this.host.reducedMotion ? 0.7 : 1;
    const ms = (opts.quiet ? 140 : Math.max(130, Math.min(300, 90 + dist * 60))) * fast;
    tw.add(box.p, { x: tx, y: ty }, {
      ms,
      ease: opts.quiet ? Easing.quadOut : Easing.backIn,
      onDone: () => {
        box.mode = 'rest';
        box.loc = { at: 'shelf', shelf: target.shelf, slot: target.slot };
        this.land(box, target.shelf, opts.quiet);
        opts.onLanded?.();
        this.settleLatest(box);
      },
    });
    tw.add(box.r, { v: 0 }, { ms });
    tw.kill(box.k);
    tw.add(box.k, { v: 1 }, { ms: 120 });
  }

  cargoToBelt(cargoId: number) {
    if (this.ended) return;
    const box = this.boxes[cargoId];
    if (!box) return;
    this.toBeltSpot(box, 0);
  }

  cargoReturn(cargoId: number) {
    if (this.ended) return;
    const box = this.boxes[cargoId];
    if (!box) return;
    const loc = this.board ? locOf(this.board, cargoId) : box.loc;
    if (loc.at === 'shelf') {
      this.cargoPlaced(cargoId, loc, { quiet: true });
    } else if (loc.at === 'belt') {
      this.toBeltSpot(box, loc.index);
    } else {
      if (this.drag?.box === box) this.endDrag();
      this.settle(box, loc, false);
    }
  }

  private toBeltSpot(box: Box, index: number) {
    const L = this.L;
    if (!L) return;
    if (this.drag?.box === box) this.endDrag();
    const tw = this.host.tweens;
    tw.kill(box.p);
    tw.kill(box.r);
    tw.kill(box.a);
    tw.kill(box.sq);
    this.detach(box);
    box.mode = 'moving';
    box.visible = true;
    box.sq.x = 1;
    box.sq.y = 1;
    const k = index === 0 ? 1 : BELT_2D.queuedScale;
    const x = index === 0 ? L.liveX : L.queueX[Math.min(1, index - 1)];
    const fast = this.host.reducedMotion ? 0.7 : 1;
    tw.add(box.p, { x, y: BELT_2D.topY + (W3.cargoH * k) / 2 }, {
      ms: 260 * fast,
      ease: Easing.backOut,
      onDone: () => {
        box.mode = 'rest';
        box.loc = { at: 'belt', index };
        this.settleLatest(box);
      },
    });
    tw.add(box.r, { v: 0 }, { ms: 200 * fast });
    tw.kill(box.k);
    tw.add(box.k, { v: k }, { ms: 200 * fast });
    tw.add(box.a, { v: index === 0 ? 1 : 0.62 }, { ms: 160 });
  }

  // ==========================================================================
  // GameView: outcomes
  // ==========================================================================

  /** Ends any drag and puts every package in hand or in flight at its committed spot. */
  private settleHand() {
    if (this.drag) this.endDrag();
    this.ghost = null;
    this.beltHover = false;
    this.clearHint();
    const board = this.board;
    for (const box of this.boxes) {
      if (box.mode !== 'hand' && box.mode !== 'loose' && box.mode !== 'moving') continue;
      this.host.tweens.kill(box.r);
      this.settle(box, board ? locOf(board, box.id) : box.loc, false);
    }
  }

  private stowed(): Box[] {
    return this.boxes.filter((b) => b.loc.at === 'shelf' && b.mode === 'rest' && b.visible);
  }

  celebrate() {
    const L = this.L;
    if (!L) return;
    this.settleHand();
    this.ended = true;
    const top = L.rackTop;
    this.emit('confetti', 0, top + 0.5, 46);
    this.after(220, () => this.emit('confetti', -2, top, 26));
    this.after(400, () => this.emit('confetti', 2, top, 26));
    const tw = this.host.tweens;
    tw.kill(this.rackState);
    this.rackState.pop = 1;
    tw.add(this.rackState, { pop: 1.03 }, {
      ms: 170,
      yoyo: true,
      onDone: () => {
        this.rackState.pop = 1;
      },
    });
  }

  dispatch(cb?: DispatchCallbacks) {
    this.settleHand();
    this.ended = true;
    this.frozen = true;
    this.dispatched = true;
    if (this.board) this.derive(this.board);
    else this.tiltTarget = 0;
    this.wobble = false;
    const reduced = this.host.reducedMotion;
    const ms = reduced ? 360 : 540;
    const stagger = reduced ? 35 : 55;
    const leaving = this.stowed();
    for (const box of leaving) {
      box.cracked = false;
      this.detach(box);
    }
    leaving.sort((a, b) => a.p.x - b.p.x);
    const tw = this.host.tweens;
    leaving.forEach((box, i) => {
      box.mode = 'gone';
      const delay = i * stagger;
      tw.add(box.p, { x: box.p.x + 14, y: box.p.y + 0.3 }, { ms, delay, ease: Easing.backIn });
      tw.add(box.a, { v: 0 }, { ms, delay, ease: Easing.quadIn });
      this.after(delay, () => {
        this.emit('dust', box.p.x, box.p.y - W3.cargoH / 2, 4);
        cb?.onEach?.(box.id, i);
      });
    });
    const total = leaving.length ? (leaving.length - 1) * stagger + ms : 0;
    this.after(total, () => cb?.onDone?.());
  }

  failCollapse(direction: number) {
    this.settleHand();
    this.ended = true;
    this.frozen = true;
    this.wobble = false;
    this.collapsing = true;
    const dir = direction >= 0 ? 1 : -1;
    const tw = this.host.tweens;
    const rs = this.rackState;
    tw.kill(rs);
    rs.pop = 1;
    const f = this.host.reducedMotion ? 0.75 : 1;
    // Rack3D.collapse: snap over hard, then settle with a bounce.
    tw.add(rs, { tilt: -dir * 26 * DEG }, {
      ms: 420 * f,
      ease: Easing.backIn,
      onDone: () => tw.add(rs, { tilt: -dir * 21 * DEG }, { ms: 220 * f, ease: Easing.bounceOut }),
    });
    this.shake(0.32, 620);
    const victims = this.stowed().sort((a, b) => a.id - b.id);
    this.after(180, () => this.spill(victims, dir));
  }

  failOverload(tier: number, direction: number) {
    this.settleHand();
    this.ended = true;
    this.frozen = true;
    this.wobble = false;
    this.shake(0.22, 480);
    const fl = this.flex[tier];
    if (fl) {
      this.host.tweens.kill(fl);
      this.host.tweens.add(fl, { v: -0.1 }, { ms: 160, ease: Easing.bounceOut });
    }
    const victims = this.stowed()
      .filter((b) => b.loc.at === 'shelf' && b.loc.shelf <= tier)
      .sort((a, b) => a.id - b.id);
    this.after(120, () => this.spill(victims, direction >= 0 ? 1 : -1));
  }

  failFragile(cargoId: number) {
    this.settleHand();
    this.ended = true;
    this.frozen = true;
    this.wobble = false;
    this.shake(0.16, 320);
    const box = this.boxes[cargoId];
    if (!box || box.loc.at !== 'shelf' || !box.visible) return;
    const c = this.worldCentre(box);
    this.emit('glass', c.x, c.y, 26);
    this.emit('glint', c.x, c.y + 0.2, 3);
    box.cracked = true;
    box.mode = 'gone';
    const tw = this.host.tweens;
    tw.add(box.sq, { x: 1.25, y: 0.7 }, { ms: 220 });
    tw.add(box.a, { v: 0 }, { ms: 220 });
  }

  /** Deterministic per package id, so a replay of the same board looks the same. */
  private spill(victims: Box[], dir: number) {
    victims.forEach((box, i) => {
      if (box.mode !== 'rest') return;
      this.host.tweens.kill(box.p);
      this.detach(box);
      box.cracked = false;
      box.mode = 'falling';
      box.settled = false;
      box.fallDelay = i * 45;
      const r = ((box.id * 9301 + 49297) % 233280) / 233280;
      box.vx = dir * (1.5 + r * 3) + (r - 0.5) * 2;
      box.vy = 1 + r * 2;
      // Tips over the way it falls (clockwise when falling right).
      box.spin = -dir * (2 + r * 5);
    });
  }

  // ==========================================================================
  // GameView: overlays and tests
  // ==========================================================================

  clientPointOf(
    target: { cargo: number } | { shelf: number; slot: number; slots: number } | { belt: true },
  ): ClientPoint | null {
    const L = this.L;
    const level = this.level;
    if (!L || !level) return null;
    let w: Point;
    if ('cargo' in target) {
      const box = this.boxes[target.cargo];
      if (!box) return null;
      w = this.worldCentre(box);
    } else if ('belt' in target) {
      w = { x: L.liveX, y: L.beltCargoY };
    } else {
      const def = level.shelves[target.shelf];
      if (!def) return null;
      w = this.fromRack({ x: slotCentreX(def.slots, target.slot, target.slots), y: cargoCentreY(target.shelf) });
    }
    const sp = toScreen(L, w.x, w.y);
    const rect = this.host.canvas.getBoundingClientRect();
    const kx = L.width > 0 ? rect.width / L.width : 1;
    const ky = L.height > 0 ? rect.height / L.height : 1;
    return { x: rect.left + sp.x * kx, y: rect.top + sp.y * ky };
  }

  // ==========================================================================
  // Drawing
  // ==========================================================================

  draw(ctx: CanvasRenderingContext2D) {
    const L = this.L;
    const rack = this.rack;
    const level = this.level;
    if (!L || !rack || !level || !this.bg) return;
    const s = L.scale;
    const dpr = this.dpr;
    ctx.drawImage(this.bg, 0, 0, L.width, L.height);
    const ox = this.shakeX;
    const oy = this.shakeY;
    ctx.setTransform(dpr, 0, 0, dpr, dpr * ox, dpr * oy);

    // --- rack space ---
    ctx.save();
    this.rackTransform(ctx, L);
    rack.drawGlows(ctx, this.glowAlpha);
    rack.drawColumns(ctx, this.columns, this.emphasise);
    rack.drawDecor(ctx, this.zoneEmpty);
    rack.drawFrame(ctx);
    for (let t = 0; t < level.shelves.length; t++) {
      rack.drawShelf(ctx, t, this.flex[t]?.v ?? 0);
      if (this.overloaded[t]) this.drawOverloadMark(ctx, t, s);
    }
    this.drawHeldOutline(ctx, s);
    for (const box of this.boxes) if (box.space === 'rack' && box.mode !== 'moving') this.drawBox(ctx, box, s);
    if (this.hint) this.drawGhost(ctx, this.hint.shelf, this.hint.slot, this.hint.slots, 'hint', s);
    const g = this.ghost;
    if (g) this.drawGhost(ctx, g.shelf, g.slot, g.slots, g.kind, s, this.drag ? 'under' : 'all');
    this.drawRackSpot(ctx, s);
    ctx.restore();

    // --- belt ---
    this.drawBelt(ctx, L);

    // --- world space ---
    ctx.save();
    ctx.translate(L.originX, L.floorY);
    for (let i = 2; i >= 0; i--) {
      for (const box of this.boxes) {
        if (box.space === 'world' && box.mode === 'rest' && box.loc.at === 'belt' && box.loc.index === i) this.drawBox(ctx, box, s);
      }
    }
    for (const box of this.boxes) {
      if (box.space !== 'world' || box.mode === 'hand') continue;
      if (box.mode === 'rest' && box.loc.at === 'belt') continue;
      this.drawBox(ctx, box, s);
    }
    ctx.restore();

    // Packages flying into the rack draw over the belt.
    ctx.save();
    this.rackTransform(ctx, L);
    for (const box of this.boxes) if (box.space === 'rack' && box.mode === 'moving') this.drawBox(ctx, box, s);
    ctx.restore();

    ctx.save();
    ctx.translate(L.originX, L.floorY);
    this.drawWorldSpot(ctx, s);
    const d = this.drag;
    if (d) {
      this.drawInHand(ctx, d, s);
      if (this.beltHover) {
        // The target kind rides on the package in hand, as the ghost icon does.
        const r = Math.max(8, Math.min(W3.cargoH * s * 0.26, 14));
        drawIcon(ctx, 'belt', d.box.p.x * s, -(d.box.p.y + (W3.cargoH * d.box.k.v) / 2) * s, r, '#4da3ff');
      }
    }
    ctx.restore();

    if (d && g) {
      ctx.save();
      this.rackTransform(ctx, L);
      this.drawGhost(ctx, g.shelf, g.slot, g.slots, g.kind, s, 'over');
      ctx.restore();
    }

    this.host.particles.draw(ctx, L, dpr, ox, oy);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Rack-local CSS px: origin at the rack's floor centre, leaning on its low-side foot. */
  private rackTransform(ctx: CanvasRenderingContext2D, L: Layout2D) {
    const tilt = this.rackState.tilt;
    const o = leanOffset(tilt, L.halfWidth);
    ctx.translate(L.originX + o.x * L.scale, L.floorY - o.y * L.scale);
    ctx.rotate(-tilt);
    const pop = this.rackState.pop;
    if (pop !== 1) ctx.scale(pop, pop);
  }

  /** One package; `ctx` is at the origin of its space (rack pivot or world floor centre). */
  private drawBox(ctx: CanvasRenderingContext2D, box: Box, s: number) {
    if (!box.visible || box.a.v <= 0.01) return;
    const spr = this.sprite(box.type, box.cracked);
    const k = box.k.v;
    let lift = 0;
    if (box.id === this.selected && box.mode === 'rest') lift = this.selectLift;
    let rot = box.r.v;
    if (box.cracked && box.mode === 'rest' && !this.host.reducedMotion) {
      // Cargo3D.setCracking: a nervous 70 ms judder.
      const ph = (this.time / 70) % 2;
      rot += 0.03 * (ph < 1 ? ph : 2 - ph);
    }
    ctx.save();
    ctx.globalAlpha = box.a.v;
    ctx.translate(box.p.x * s, -(box.p.y + lift) * s);
    if (rot !== 0) ctx.rotate(-rot);
    const half = spr.h / 2;
    ctx.translate(0, half * k);
    ctx.scale(box.sq.x * k, box.sq.y * k);
    ctx.translate(0, -half);
    ctx.drawImage(spr.canvas, -spr.w / 2 - spr.pad, -half - spr.pad, spr.w + spr.pad * 2, spr.h + spr.pad * 2);
    ctx.globalAlpha = 1;
    if (this.hint?.id === box.id) this.drawHintPulse(ctx, spr);
    if (this.selected === box.id) this.drawSelectRing(ctx, spr);
    ctx.restore();
  }

  private pulse(periodMs: number): number {
    if (this.host.reducedMotion) return 0.7;
    return 0.5 - 0.5 * Math.cos((this.time / periodMs) * Math.PI * 2);
  }

  /** Cargo3D.setHinted: gold pulse, 420 ms each way. */
  private drawHintPulse(ctx: CanvasRenderingContext2D, spr: CargoSprite) {
    const v = this.pulse(840);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,201,60,${(0.08 + v * 0.3).toFixed(3)})`;
    roundRect(ctx, -spr.w / 2, -spr.h / 2, spr.w, spr.h, 3);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#ffc93c';
    ctx.lineWidth = 2 + v * 2;
    roundRect(ctx, -spr.w / 2 - 2, -spr.h / 2 - 2, spr.w + 4, spr.h + 4, 5);
    ctx.stroke();
  }

  private drawSelectRing(ctx: CanvasRenderingContext2D, spr: CargoSprite) {
    const v = this.pulse(900);
    const g = 3 + v * 3;
    ctx.strokeStyle = 'rgba(77,163,255,0.35)';
    ctx.lineWidth = 6;
    roundRect(ctx, -spr.w / 2 - g, -spr.h / 2 - g, spr.w + g * 2, spr.h + g * 2, 6);
    ctx.stroke();
    ctx.strokeStyle = '#8cc4ff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  /** The package in hand, with a lift shadow that grows as it rises. */
  private drawInHand(ctx: CanvasRenderingContext2D, d: Drag, s: number) {
    const box = d.box;
    const shadow = this.shadow;
    if (shadow) {
      const w = box.w * s * 1.25;
      const h = 0.34 * s;
      const x = box.p.x * s + 0.1 * s;
      const y = -(box.p.y - W3.cargoH / 2) * s + (0.12 + d.lift * 0.22) * s;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(shadow, x - w / 2, y - h / 2, w, h);
      ctx.globalAlpha = 1;
    }
    this.drawBox(ctx, box, s);
  }

  /** Faint dashed outline at the committed slot of a stowed package in hand. */
  private drawHeldOutline(ctx: CanvasRenderingContext2D, s: number) {
    const level = this.level;
    if (!level) return;
    let loc: Loc | null = null;
    let slots = 1;
    if (this.drag) {
      loc = this.drag.origin;
      slots = this.drag.box.slots;
    } else if (this.board?.held != null && this.boxes[this.board.held]?.mode === 'hand') {
      loc = locOf(this.board, this.board.held);
      slots = this.boxes[this.board.held].slots;
    }
    if (!loc || loc.at !== 'shelf') return;
    const def = level.shelves[loc.shelf];
    if (!def) return;
    const w = (slots * W3.slot - W3.cargoGap) * s;
    const h = W3.cargoH * s;
    const cx = slotCentreX(def.slots, loc.slot, slots) * s;
    const cy = -cargoCentreY(loc.shelf) * s;
    ctx.fillStyle = 'rgba(238,244,255,0.05)';
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 4);
    ctx.fill();
    ctx.setLineDash(DASH_HELD);
    ctx.strokeStyle = 'rgba(238,244,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
  }

  /** Every cell a package would occupy, with a pattern and an icon per kind (never colour alone). */
  /**
   * `under` is the fill and pattern (drawn below the package in hand), `over`
   * the outline, cell dividers and icon (drawn above it: in a front view the
   * package in hand sits right on its target and would hide it), `all` both.
   */
  private drawGhost(
    ctx: CanvasRenderingContext2D,
    shelf: number,
    slot: number,
    slots: number,
    kind: TargetKind | 'hint',
    s: number,
    part: 'under' | 'over' | 'all' = 'all',
  ) {
    const def = this.level?.shelves[shelf];
    if (!def) return;
    const st = GHOST[kind];
    const w = (slots * W3.slot - W3.cargoGap) * s;
    const h = W3.cargoH * s;
    const cx = slotCentreX(def.slots, slot, slots) * s;
    const cy = -cargoCentreY(shelf) * s;
    const x = cx - w / 2;
    const y = cy - h / 2;
    if (part !== 'over') {
      ctx.fillStyle = st.fill;
      roundRect(ctx, x, y, w, h, 4);
      ctx.fill();
      if (st.pattern) hatch(ctx, x, y, w, h, Math.max(7, 0.18 * s), st.pattern, kind === 'bad');
    }
    if (part === 'under') return;
    // Cell dividers so a long package shows all three cells.
    if (slots > 1) {
      ctx.setLineDash(DASH_CELL);
      ctx.strokeStyle = st.line;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 1; i < slots; i++) {
        const lx = (slot + i - def.slots / 2) * W3.slot * s;
        ctx.moveTo(lx, y + 3);
        ctx.lineTo(lx, y + h - 3);
      }
      ctx.stroke();
    }
    ctx.setLineDash(kind === 'crush' || kind === 'hint' ? DASH_CRUSH : NO_DASH);
    ctx.strokeStyle = st.line;
    ctx.lineWidth = kind === 'bad' ? 3 : 2.5;
    roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 4);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    const r = Math.max(8, Math.min(h * 0.26, 14));
    // Over a package in hand the icon rides the top edge, clear of its weight plate.
    drawIcon(ctx, st.icon, cx, part === 'over' ? y : cy, r, st.line);
  }

  /** Small warning mark at the end of an overloaded shelf's label. */
  private drawOverloadMark(ctx: CanvasRenderingContext2D, t: number, s: number) {
    const def = this.level?.shelves[t];
    if (!def) return;
    const x = (def.slots / 2) * s + 0.02 * s;
    const y = -(shelfSurfaceY(t) - 0.08) * s;
    const r = Math.max(7, 0.17 * s);
    drawIcon(ctx, 'crush', x, y, r, '#ff5f57');
  }

  /** Highlight on a shelf or a stowed package (rack space). */
  private drawRackSpot(ctx: CanvasRenderingContext2D, s: number) {
    const h = this.spot;
    const rack = this.rack;
    if (!h || !rack) return;
    let box: { x: number; y: number; w: number; h: number } | null = null;
    if ('shelf' in h) {
      if (!this.level?.shelves[h.shelf]) return;
      box = rack.tierBox(h.shelf);
    } else {
      const b = this.boxes[h.cargo];
      if (!b || b.space !== 'rack' || !b.visible) return;
      box = this.boxRect(b, s);
    }
    this.drawSpot(ctx, box, s);
  }

  /** Highlight on a package in world space (belt, falling). */
  private drawWorldSpot(ctx: CanvasRenderingContext2D, s: number) {
    const h = this.spot;
    if (!h || !('cargo' in h)) return;
    const b = this.boxes[h.cargo];
    if (!b || b.space !== 'world' || !b.visible) return;
    this.drawSpot(ctx, this.boxRect(b, s), s);
  }

  private boxRect(b: Box, s: number) {
    const w = b.w * b.k.v * s;
    const h = W3.cargoH * b.k.v * s;
    return { x: b.p.x * s - w / 2, y: -b.p.y * s - h / 2, w, h };
  }

  private drawSpot(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, s: number) {
    const v = this.pulse(1000);
    const g = 3 + v * 4;
    ctx.strokeStyle = `rgba(255,201,60,${(0.25 + v * 0.35).toFixed(3)})`;
    ctx.lineWidth = 7;
    roundRect(ctx, r.x - g, r.y - g, r.w + g * 2, r.h + g * 2, 8);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    const ir = Math.max(9, 0.2 * s);
    drawIcon(ctx, 'down', r.x + r.w / 2, r.y - g - ir - 2 - v * 3, ir, '#ffc93c');
  }

  // --- belt -------------------------------------------------------------------

  private bakeBelt() {
    const L = this.L;
    if (!L) return;
    const s = L.scale;
    const dpr = this.dpr;
    const W = L.width;
    const faceH = BELT_2D.height * s;
    const legH = 0.75 * s;
    const [body, b] = makeCanvas(W * dpr, (faceH + legH) * dpr);
    b.scale(dpr, dpr);
    // Legs under the belt.
    const pitch = 2.2 * s;
    for (let x = (L.originX % pitch) - pitch; x < W + pitch; x += pitch) {
      b.fillStyle = '#1c2431';
      b.fillRect(x - 0.05 * s, faceH, 0.1 * s, legH);
      b.fillStyle = 'rgba(150,170,200,0.18)';
      b.fillRect(x - 0.05 * s, faceH, Math.max(1, 0.02 * s), legH);
    }
    const shade = b.createLinearGradient(0, faceH, 0, faceH + legH);
    shade.addColorStop(0, 'rgba(0,0,0,0.55)');
    shade.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = shade;
    b.fillRect(0, faceH, W, legH);
    // Frame: lit top rail and dark bottom rail around the moving face.
    b.fillStyle = '#9aabc2';
    b.fillRect(0, 0, W, Math.max(2, 0.05 * s));
    b.fillStyle = '#2c3644';
    b.fillRect(0, faceH - Math.max(2, 0.05 * s), W, Math.max(2, 0.05 * s));
    this.beltBody = body;

    // The moving face: one Conveyor3D texture tile per world unit, chevrons toward the pickup.
    const rail = Math.max(2, 0.05 * s);
    const h = faceH - rail * 2;
    const [strip, c] = makeCanvas((W + s * 2) * dpr, h * dpr);
    c.scale(dpr, dpr);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2d3747');
    g.addColorStop(0.5, '#232b38');
    g.addColorStop(1, '#171e28');
    c.fillStyle = g;
    c.fillRect(0, 0, W + s * 2, h);
    c.lineWidth = Math.max(2, 0.05 * s);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (let x = 0; x < W + s * 2; x += s) {
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(x, 0, s * 0.0625, h);
      c.fillStyle = 'rgba(255,255,255,0.07)';
      c.fillRect(x + s * 0.0625, 0, s * 0.03, h);
      c.strokeStyle = 'rgba(240,165,60,0.42)';
      c.beginPath();
      c.moveTo(x + s * 0.62, h * 0.22);
      c.lineTo(x + s * 0.4, h * 0.5);
      c.lineTo(x + s * 0.62, h * 0.78);
      c.stroke();
    }
    this.beltStrip = strip;
  }

  private drawBelt(ctx: CanvasRenderingContext2D, L: Layout2D) {
    const body = this.beltBody;
    const strip = this.beltStrip;
    if (!body || !strip) return;
    const s = L.scale;
    const top = toScreen(L, 0, BELT_2D.topY).y;
    const faceH = BELT_2D.height * s;
    const rail = Math.max(2, 0.05 * s);
    const W = L.width;
    // Scrolls toward the pickup (left): the source window slides right.
    const off = ((this.beltScroll * s) % s + s) % s;
    const dpr = this.dpr;
    ctx.drawImage(strip, off * dpr, 0, W * dpr, strip.height, 0, top + rail, W, faceH - rail * 2);
    ctx.drawImage(body, 0, top, W, body.height / dpr);
    // Pickup marks either side of the live spot.
    const lx = L.originX + L.liveX * s;
    const half = (W3.slot * 0.5 + 0.08) * s;
    ctx.fillStyle = 'rgba(240,165,60,0.8)';
    ctx.fillRect(lx - half, top - 1, Math.max(3, 0.08 * s), Math.max(3, 0.08 * s));
    ctx.fillRect(lx + half - Math.max(3, 0.08 * s), top - 1, Math.max(3, 0.08 * s), Math.max(3, 0.08 * s));

    if (this.beltHover) {
      const v = this.pulse(700);
      ctx.fillStyle = `rgba(77,163,255,${(0.3 + v * 0.2).toFixed(3)})`;
      ctx.fillRect(0, top, W, faceH);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(77,163,255,0.16)';
      ctx.fillRect(0, top - W3.cargoH * s * 1.1, W, W3.cargoH * s * 1.1);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#8cc4ff';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, top + 1.5, W - 3, faceH - 3);
      // Where the package will sit: the live spot.
      const w = (W3.slot - W3.cargoGap) * s;
      const h = W3.cargoH * s;
      const y = top - h;
      ctx.fillStyle = 'rgba(77,163,255,0.14)';
      roundRect(ctx, lx - w / 2, y, w, h, 4);
      ctx.fill();
      ctx.setLineDash(DASH_HELD);
      ctx.strokeStyle = '#8cc4ff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      drawIcon(ctx, 'belt', lx, y + h / 2, Math.max(9, Math.min(14, h * 0.28)), '#4da3ff');
    }
  }
}
