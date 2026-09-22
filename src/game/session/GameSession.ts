/**
 * One shipment's rules state, independent of any renderer.
 *
 * The session owns the committed board (which package sits where), the belt
 * queue, the hazard clocks and the active-play clock. Views read it and send
 * it semantic commands - "put package 3 on shelf 1, slot 2" - never pixels or
 * meshes.
 *
 * Two rules the old controller did not have:
 *
 * - Picking something up does not change the board. The package in the
 *   player's hand is still where the rules last saw it until a command moves
 *   it, so holding a crate off a red rack does not stop the clock.
 * - Every change is one atomic command: a move either happens completely or
 *   is refused with a reason, and a refused move changes nothing.
 *
 * Everything the getters return is a copy or frozen: a view can read the
 * board but never edit it behind the rules' back.
 */

import { MAX_FRAME_CATCHUP_MS, MAX_STEP_MS, WIN_SETTLE_MS } from '../config';
import type { LevelDef } from '../levels/types';
import { crushersAbove, evaluate } from '../systems/BalanceSystem';
import type { BoardEval, Placement } from '../systems/BalanceSystem';
import { HazardSystem } from '../systems/HazardSystem';
import type { HazardSnapshot, HazardState } from '../systems/HazardSystem';
import { PlacementSystem } from '../systems/PlacementSystem';
import { hintFor } from '../systems/Solver';
import type { Hint } from '../systems/Solver';
import { levelFingerprint } from './fingerprint';
import { blockingReason, finishLimit } from './rules';
import type { BlockReason } from './rules';
import type {
  Assists,
  CargoLocation,
  FailureFacts,
  MoveResult,
  SessionPhase,
  ShipmentOutcome,
  ShipmentSnapshot,
  ShipmentSource,
  TargetPreview,
  TickResult,
  UndoFrame,
} from './types';
import { GENERATOR_VERSION, RULESET_VERSION } from './versions';

export interface SessionOptions {
  source: ShipmentSource;
  /** Multiplier on every hazard grace period (Endless shortens them). */
  graceScale?: number;
  /** Free one-step undos for this shipment. */
  undoAllowance?: number;
  /** Create the session paused (e.g. the next wave is dealt while the app is hidden). */
  startPaused?: boolean;
}

export type RestoreErrorCode = 'level-changed' | 'corrupt' | 'unsupported';

export class SessionRestoreError extends Error {
  constructor(readonly code: RestoreErrorCode) {
    super(`cannot restore shipment: ${code}`);
  }
}

const IDLE_HAZARD: HazardState = Object.freeze({
  kind: null,
  remaining: 0,
  total: 1,
  owner: -1,
  urgency: 0,
  expired: false,
});

const PHASES: readonly SessionPhase[] = ['play', 'paused', 'won', 'failed'];

function freezeEval(ev: BoardEval): BoardEval {
  Object.freeze(ev.shelfWeights);
  Object.freeze(ev.overloaded);
  Object.freeze(ev.crushed);
  return Object.freeze(ev);
}

export class GameSession {
  readonly level: LevelDef;
  readonly source: ShipmentSource;
  readonly graceScale: number;

  private board: PlacementSystem;
  private hazards: HazardSystem;
  private queueIds: number[];
  private phaseValue: SessionPhase = 'play';
  private evalCache: BoardEval;
  private lastHazard: HazardState = IDLE_HAZARD;
  private heldId: number | null = null;

  private winSettleMs = 0;
  private activeMsValue = 0;
  private dangerMsValue = 0;
  private assistsValue: Assists = { hints: 0, undos: 0 };
  private rejected = 0;
  private undoLeftValue: number;
  private undoFrame: UndoFrame | null = null;
  private outcomeValue: ShipmentOutcome | null = null;
  private rev = 0;

  constructor(level: LevelDef, opts: SessionOptions) {
    this.level = level;
    this.source = Object.freeze({ ...opts.source });
    this.graceScale = opts.graceScale ?? 1;
    this.undoLeftValue = Math.max(0, Math.floor(opts.undoAllowance ?? 0));
    this.board = new PlacementSystem(level);
    this.hazards = new HazardSystem(level, this.graceScale);
    this.queueIds = level.packages.map((_, i) => i);
    this.evalCache = freezeEval(this.board.evaluate());
    this.lastHazard = this.hazards.peek(this.evalCache);
    if (opts.startPaused) this.phaseValue = 'paused';
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  get phase(): SessionPhase {
    return this.phaseValue;
  }

  /**
   * Bumped by every change worth persisting: a committed move, undo, a
   * counted hint, pause/resume and the end of the shipment. A save layer
   * writes when this differs from what it last wrote.
   */
  get revision(): number {
    return this.rev;
  }

  /** Belt order; index 0 is the live package. A frozen copy. */
  get queue(): readonly number[] {
    return Object.freeze([...this.queueIds]);
  }

  /** Package on the front of the belt, or null when the belt is empty. */
  get current(): number | null {
    return this.queueIds[0] ?? null;
  }

  /** Committed placements (frozen objects in a fresh array). */
  get placements(): Placement[] {
    return this.board.list;
  }

  get evaluation(): BoardEval {
    return this.evalCache;
  }

  /**
   * The hazard clocks as they stand: the last tick's reading, refreshed after
   * every command, undo and restore, and held (not blanked) while paused.
   */
  get hazard(): HazardState {
    return this.lastHazard;
  }

  /** Package the player is holding (input state; never part of the board). */
  get held(): number | null {
    return this.heldId;
  }

  get remaining(): number {
    return this.level.packages.length - this.board.count;
  }

  get assists(): Assists {
    return { ...this.assistsValue };
  }

  get rejectedDrops(): number {
    return this.rejected;
  }

  get activeMs(): number {
    return this.activeMsValue;
  }

  get dangerMs(): number {
    return this.dangerMsValue;
  }

  get undoLeft(): number {
    return this.undoLeftValue;
  }

  get canUndo(): boolean {
    return this.phaseValue === 'play' && this.heldId === null && this.undoLeftValue > 0 && this.undoFrame !== null;
  }

  get outcome(): ShipmentOutcome | null {
    return this.outcomeValue ? cloneOutcome(this.outcomeValue) : null;
  }

  locationOf(id: number): CargoLocation | null {
    const p = this.board.get(id);
    if (p) return { at: 'shelf', shelf: p.shelf, slot: p.slot };
    const index = this.queueIds.indexOf(id);
    return index >= 0 ? { at: 'belt', index } : null;
  }

  /** Stowed packages and the live belt package can be picked up. */
  isMovable(id: number): boolean {
    if (this.phaseValue !== 'play') return false;
    return this.board.has(id) || this.queueIds[0] === id;
  }

  /** Ids the player may pick up right now: the live belt package first, then stowed ones. */
  movable(): number[] {
    if (this.phaseValue !== 'play') return [];
    const out = this.board.list.map((p) => p.id);
    if (this.queueIds.length) out.unshift(this.queueIds[0]);
    return out;
  }

  /** What moving `id` to (shelf, slot) would do. Changes nothing. */
  preview(id: number, shelf: number, slot: number): TargetPreview {
    const type = this.level.packages[id];
    const rejection = type === undefined ? 'out-of-bounds' : this.board.check(type, shelf, slot, id);
    if (rejection) {
      return { kind: 'bad', rejection, evaluation: null, willCrush: false, willOverload: false };
    }
    const evaluation = this.board.previewEval(type, shelf, slot, id);
    // Only crushes this move would cause count: an existing crush elsewhere must
    // not paint every target as dangerous while the player is fixing it.
    const before = evaluate(
      this.level,
      this.board.list.filter((p) => p.id !== id),
    ).crushed;
    const willCrush = evaluation.crushed.some((c) => !before.includes(c));
    const willOverload = evaluation.overloaded.includes(shelf);
    return {
      kind: willCrush || willOverload ? 'crush' : 'ok',
      rejection: null,
      evaluation,
      willCrush,
      willOverload,
    };
  }

  /** Why a full board cannot finish yet, or null. */
  blockReason(): BlockReason | null {
    return blockingReason(this.level, this.board.count, this.evalCache);
  }

  get canFinish(): boolean {
    return this.remaining === 0 && this.blockReason() === null;
  }

  // ==========================================================================
  // Commands
  // ==========================================================================

  /**
   * Marks a package as in the player's hand. The board is untouched; the only
   * effect is that a finished board does not settle into a win while the
   * player is still holding something. Only one package can be held.
   */
  hold(id: number): boolean {
    if (!this.isMovable(id)) return false;
    if (this.heldId !== null && this.heldId !== id) return false;
    this.heldId = id;
    return true;
  }

  /** Lets go of `id` (or of whatever is held when no id is given). */
  release(id?: number) {
    if (id === undefined || id === this.heldId) this.heldId = null;
  }

  /** Atomically moves a package from the belt or a shelf to a shelf slot. */
  move(id: number, shelf: number, slot: number): MoveResult {
    if (this.phaseValue !== 'play') return { ok: false, rejection: 'not-playing' };
    if (!this.isMovable(id)) return { ok: false, rejection: 'not-movable' };
    // While one package is in hand nothing else may change under it.
    if (this.heldId !== null && this.heldId !== id) return { ok: false, rejection: 'not-movable' };
    const from = this.locationOf(id) as CargoLocation;
    this.release(id);

    if (from.at === 'shelf' && from.shelf === shelf && from.slot === slot) {
      return { ok: true, changed: false, from };
    }
    // A malformed target is a caller bug, not a player's refused drop.
    if (!Number.isInteger(shelf) || !Number.isInteger(slot)) return { ok: false, rejection: 'out-of-bounds' };
    const type = this.level.packages[id];
    const rejection = this.board.check(type, shelf, slot, id);
    if (rejection) {
      this.rejected++;
      return { ok: false, rejection };
    }

    this.captureUndo();
    if (from.at === 'belt') this.queueIds.shift();
    this.board.place(id, type, shelf, slot);
    this.afterChange();
    this.rev++;
    return { ok: true, changed: true, from };
  }

  /** Atomically takes a stowed package off its shelf and puts it at the front of the belt. */
  toBelt(id: number): MoveResult {
    if (this.phaseValue !== 'play') return { ok: false, rejection: 'not-playing' };
    const from = this.locationOf(id);
    if (!from) return { ok: false, rejection: 'not-movable' };
    if (this.heldId !== null && this.heldId !== id) return { ok: false, rejection: 'not-movable' };
    if (from.at === 'belt') {
      if (from.index !== 0) return { ok: false, rejection: 'not-movable' };
      this.release(id);
      return { ok: true, changed: false, from };
    }
    this.release(id);
    this.captureUndo();
    this.board.remove(id);
    this.queueIds.unshift(id);
    this.afterChange();
    this.rev++;
    return { ok: true, changed: true, from };
  }

  /**
   * Restores the board and the belt to how they were before the last
   * committed command. Consumes one undo; the assist is recorded and never
   * erased. Play time and refused drops are not rewound.
   *
   * Hazard clocks come back from the snapshot, but a danger that was already
   * running before the undone command and is still running now keeps the
   * lower of the two readings - undo takes back a move, it does not buy
   * extra seconds on a rack that was red all along.
   */
  undo(): boolean {
    if (!this.canUndo || !this.undoFrame) return false;
    const f = this.undoFrame;
    this.undoFrame = null;
    this.undoLeftValue--;
    this.assistsValue.undos++;
    this.heldId = null;
    const now = this.hazards.snapshot();
    this.board.clear();
    for (const p of f.placements) this.board.place(p.id, this.level.packages[p.id], p.shelf, p.slot);
    this.queueIds = [...f.queue];
    this.hazards.restore(minMerge(f.hazards, now));
    this.winSettleMs = 0;
    this.evalCache = freezeEval(this.board.evaluate());
    this.lastHazard = this.hazards.peek(this.evalCache);
    this.rev++;
    return true;
  }

  /**
   * Solver hint for the live package. Counts as an assist only when the
   * solver has an answer.
   */
  hint(): Hint | null {
    const current = this.current;
    if (this.phaseValue !== 'play' || current === null || this.heldId !== null) return null;
    const hint = hintFor(this.level, this.board.list, [...this.queueIds], current);
    if (hint.kind !== 'stuck') {
      this.assistsValue.hints++;
      this.rev++;
    }
    return hint;
  }

  pause(): boolean {
    if (this.phaseValue !== 'play') return false;
    this.phaseValue = 'paused';
    this.heldId = null;
    this.rev++;
    return true;
  }

  resume(): boolean {
    if (this.phaseValue !== 'paused') return false;
    this.phaseValue = 'play';
    this.rev++;
    return true;
  }

  /**
   * Advances the rules clocks by one step of at most MAX_STEP_MS. No-op unless
   * playing. Deterministic: the same steps always give the same result.
   */
  tick(dtMs: number): TickResult {
    if (this.phaseValue !== 'play' || !Number.isFinite(dtMs) || dtMs <= 0) {
      return { hazard: this.phaseValue === 'won' || this.phaseValue === 'failed' ? IDLE_HAZARD : this.lastHazard, outcome: null };
    }
    const dt = Math.min(dtMs, MAX_STEP_MS);
    this.activeMsValue += dt;
    const hz = Object.freeze(this.hazards.update(this.evalCache, dt));
    this.lastHazard = hz;

    if (hz.kind) {
      this.dangerMsValue += dt;
      this.winSettleMs = 0;
      if (hz.expired) return { hazard: hz, outcome: this.finish('failed', this.failureFacts(hz)) };
      return { hazard: hz, outcome: null };
    }

    if (this.canFinish && this.heldId === null) {
      this.winSettleMs += dt;
      if (this.winSettleMs >= WIN_SETTLE_MS) return { hazard: hz, outcome: this.finish('won') };
    } else {
      this.winSettleMs = 0;
    }
    return { hazard: hz, outcome: null };
  }

  /**
   * Charges one animation frame of real time to the rules clocks, in
   * MAX_STEP_MS steps, so a slow frame rate never buys extra seconds. At most
   * MAX_FRAME_CATCHUP_MS is charged per call.
   */
  advance(realMs: number): TickResult {
    let left = Number.isFinite(realMs) ? Math.min(Math.max(0, realMs), MAX_FRAME_CATCHUP_MS) : 0;
    let last = this.tick(0);
    while (left > 1e-9 && this.phaseValue === 'play') {
      const step = Math.min(left, MAX_STEP_MS);
      last = this.tick(step);
      left -= step;
      if (last.outcome) break;
    }
    return last;
  }

  // ==========================================================================
  // Snapshots
  // ==========================================================================

  snapshot(): ShipmentSnapshot {
    return {
      v: 1,
      ruleset: RULESET_VERSION,
      generator: GENERATOR_VERSION,
      source: { ...this.source },
      levelFingerprint: levelFingerprint(this.level),
      graceScale: this.graceScale,
      phase: this.phaseValue,
      placements: this.board.list.map((p) => ({ ...p })),
      queue: [...this.queueIds],
      hazards: this.hazards.snapshot(),
      winSettleMs: this.winSettleMs,
      activeMs: this.activeMsValue,
      dangerMs: this.dangerMsValue,
      assists: { ...this.assistsValue },
      rejectedDrops: this.rejected,
      undoLeft: this.undoLeftValue,
      undo: this.undoFrame ? cloneFrame(this.undoFrame) : null,
      outcome: this.outcomeValue ? cloneOutcome(this.outcomeValue) : null,
    };
  }

  /**
   * Rebuilds a session from a snapshot. A shipment that was being played
   * comes back paused - resuming is always the player's decision.
   *
   * Throws SessionRestoreError: 'unsupported' for another snapshot format or
   * ruleset/generator, 'level-changed' when the level data no longer matches,
   * 'corrupt' for anything malformed. Never any other error.
   */
  static restore(level: LevelDef, snap: ShipmentSnapshot): GameSession {
    try {
      return GameSession.restoreUnchecked(level, snap);
    } catch (e) {
      if (e instanceof SessionRestoreError) throw e;
      throw new SessionRestoreError('corrupt');
    }
  }

  private static restoreUnchecked(level: LevelDef, snap: ShipmentSnapshot): GameSession {
    if (!snap || typeof snap !== 'object' || snap.v !== 1) throw new SessionRestoreError('unsupported');
    if (snap.ruleset !== RULESET_VERSION) throw new SessionRestoreError('unsupported');
    if (snap.source?.mode === 'endless' && snap.generator !== GENERATOR_VERSION) {
      throw new SessionRestoreError('unsupported');
    }
    if (snap.levelFingerprint !== levelFingerprint(level)) throw new SessionRestoreError('level-changed');
    if (!isConsistent(level, snap)) throw new SessionRestoreError('corrupt');

    const s = new GameSession(level, {
      source: snap.source,
      graceScale: snap.graceScale,
      undoAllowance: snap.undoLeft,
    });
    for (const p of snap.placements) s.board.place(p.id, level.packages[p.id], p.shelf, p.slot);
    s.queueIds = [...snap.queue];
    s.hazards.restore(snap.hazards);
    s.phaseValue = snap.phase === 'play' ? 'paused' : snap.phase;
    s.winSettleMs = snap.winSettleMs;
    s.activeMsValue = snap.activeMs;
    s.dangerMsValue = snap.dangerMs;
    s.assistsValue = { hints: snap.assists.hints, undos: snap.assists.undos };
    s.rejected = snap.rejectedDrops;
    s.undoFrame = snap.undo ? cloneFrame(snap.undo) : null;
    s.outcomeValue = snap.outcome ? cloneOutcome(snap.outcome) : null;
    s.evalCache = freezeEval(s.board.evaluate());
    s.lastHazard = s.hazards.peek(s.evalCache);
    return s;
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private captureUndo() {
    this.undoFrame = {
      placements: this.board.list.map((p) => ({ ...p })),
      queue: [...this.queueIds],
      hazards: this.hazards.snapshot(),
    };
  }

  private afterChange() {
    this.winSettleMs = 0;
    this.evalCache = freezeEval(this.board.evaluate());
    this.lastHazard = this.hazards.peek(this.evalCache);
  }

  private failureFacts(hz: HazardState): FailureFacts {
    const ev = this.evalCache;
    if (hz.kind === 'overload') {
      return {
        kind: 'overload',
        tier: hz.owner,
        load: ev.shelfWeights[hz.owner] ?? 0,
        max: this.level.shelves[hz.owner]?.maxWeight ?? 0,
      };
    }
    if (hz.kind === 'fragile') {
      return {
        kind: 'fragile',
        fragileId: hz.owner,
        crusherIds: crushersAbove(this.level, this.board.list, hz.owner),
      };
    }
    return { kind: 'balance', imbalance: ev.imbalance, tolerance: this.level.balanceTolerance, net: ev.net };
  }

  private finish(result: 'won' | 'failed', failure?: FailureFacts): ShipmentOutcome {
    this.phaseValue = result;
    this.rev++;
    this.heldId = null;
    this.undoFrame = null;
    const outcome: ShipmentOutcome = {
      result,
      ruleset: RULESET_VERSION,
      placements: this.board.list.map((p) => ({ ...p })),
      imbalance: this.evalCache.imbalance,
      limit: finishLimit(this.level),
      assists: { ...this.assistsValue },
      rejectedDrops: this.rejected,
      dangerMs: this.dangerMsValue,
      activeMs: this.activeMsValue,
    };
    if (failure) outcome.failure = failure;
    this.outcomeValue = outcome;
    return cloneOutcome(outcome);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function cloneFrame(f: UndoFrame): UndoFrame {
  return {
    placements: f.placements.map((p) => ({ ...p })),
    queue: [...f.queue],
    hazards: cloneHazards(f.hazards),
  };
}

function cloneHazards(h: HazardSnapshot): HazardSnapshot {
  return {
    balance: h.balance,
    overload: h.overload.map(([a, b]) => [a, b] as [number, number]),
    fragile: h.fragile.map(([a, b]) => [a, b] as [number, number]),
  };
}

function cloneOutcome(o: ShipmentOutcome): ShipmentOutcome {
  return JSON.parse(JSON.stringify(o)) as ShipmentOutcome;
}

/** Frame clocks, but no clock that was running both before and after the undone command gets time back. */
function minMerge(frame: HazardSnapshot, now: HazardSnapshot): HazardSnapshot {
  const nowOver = new Map(now.overload);
  const nowFrag = new Map(now.fragile);
  return {
    balance: Math.min(frame.balance, now.balance),
    overload: frame.overload.map(([k, v]) => [k, Math.min(v, nowOver.get(k) ?? v)] as [number, number]),
    fragile: frame.fragile.map(([k, v]) => [k, Math.min(v, nowFrag.get(k) ?? v)] as [number, number]),
  };
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Every package is either on the belt or on a legal, non-overlapping slot - exactly once. */
function validBoard(level: LevelDef, placements: unknown, queue: unknown): boolean {
  if (!Array.isArray(placements) || !Array.isArray(queue)) return false;
  const n = level.packages.length;
  const seen = new Set<number>();
  for (const id of queue) {
    if (!Number.isInteger(id) || id < 0 || id >= n || seen.has(id)) return false;
    seen.add(id);
  }
  const board = new PlacementSystem(level);
  for (const p of placements as Placement[]) {
    if (!p || typeof p !== 'object') return false;
    if (!Number.isInteger(p.id) || p.id < 0 || p.id >= n || seen.has(p.id)) return false;
    if (p.type !== level.packages[p.id]) return false;
    if (board.check(p.type, p.shelf, p.slot, p.id)) return false;
    board.place(p.id, p.type, p.shelf, p.slot);
    seen.add(p.id);
  }
  return seen.size === n;
}

function validHazards(level: LevelDef, h: unknown): boolean {
  if (!h || typeof h !== 'object') return false;
  const hz = h as HazardSnapshot;
  if (typeof hz.balance !== 'number' || !Number.isFinite(hz.balance)) return false;
  if (!Array.isArray(hz.overload) || !Array.isArray(hz.fragile)) return false;
  for (const e of hz.overload) {
    if (!Array.isArray(e) || e.length !== 2) return false;
    const [tier, ms] = e;
    if (!Number.isInteger(tier) || tier < 0 || tier >= level.shelves.length || !Number.isFinite(ms)) return false;
  }
  for (const e of hz.fragile) {
    if (!Array.isArray(e) || e.length !== 2) return false;
    const [id, ms] = e;
    if (level.packages[id] !== 'fragile' || !Number.isFinite(ms)) return false;
  }
  return true;
}

function isConsistent(level: LevelDef, snap: ShipmentSnapshot): boolean {
  if (!PHASES.includes(snap.phase)) return false;
  const terminal = snap.phase === 'won' || snap.phase === 'failed';
  if (terminal !== (snap.outcome !== null && snap.outcome !== undefined)) return false;
  if (snap.phase === 'won' && snap.queue.length !== 0) return false;
  if (typeof snap.graceScale !== 'number' || !(snap.graceScale >= 0.3 && snap.graceScale <= 1)) return false;
  if (!isTime(snap.winSettleMs) || !isTime(snap.activeMs) || !isTime(snap.dangerMs)) return false;
  if (snap.dangerMs > snap.activeMs + 1e-6) return false;
  if (!snap.assists || !isCount(snap.assists.hints) || !isCount(snap.assists.undos)) return false;
  if (!isCount(snap.rejectedDrops) || !isCount(snap.undoLeft)) return false;
  if (!snap.source || (snap.source.mode !== 'campaign' && snap.source.mode !== 'endless')) return false;
  if (!validBoard(level, snap.placements, snap.queue)) return false;
  if (!validHazards(level, snap.hazards)) return false;
  if (snap.undo !== null && snap.undo !== undefined) {
    if (!validBoard(level, snap.undo.placements, snap.undo.queue)) return false;
    if (!validHazards(level, snap.undo.hazards)) return false;
  }
  return true;
}
