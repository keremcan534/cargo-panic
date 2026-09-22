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
 */

import { WIN_SETTLE_MS } from '../config';
import type { LevelDef } from '../levels/types';
import { crushersAbove } from '../systems/BalanceSystem';
import type { BoardEval, Placement } from '../systems/BalanceSystem';
import { HazardSystem } from '../systems/HazardSystem';
import type { HazardState } from '../systems/HazardSystem';
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

export interface SessionOptions {
  source: ShipmentSource;
  /** Multiplier on every hazard grace period (Endless shortens them). */
  graceScale?: number;
  /** Free one-step undos for this shipment. */
  undoAllowance?: number;
}

export class SessionRestoreError extends Error {
  constructor(readonly code: 'level-changed' | 'corrupt') {
    super(`cannot restore shipment: ${code}`);
  }
}

const IDLE_HAZARD: HazardState = {
  kind: null,
  remaining: 0,
  total: 1,
  owner: -1,
  urgency: 0,
  expired: false,
};

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

  constructor(level: LevelDef, opts: SessionOptions) {
    this.level = level;
    this.source = opts.source;
    this.graceScale = opts.graceScale ?? 1;
    this.undoLeftValue = Math.max(0, Math.floor(opts.undoAllowance ?? 0));
    this.board = new PlacementSystem(level);
    this.hazards = new HazardSystem(level, this.graceScale);
    this.queueIds = level.packages.map((_, i) => i);
    this.evalCache = this.board.evaluate();
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  get phase(): SessionPhase {
    return this.phaseValue;
  }

  /** Belt order; index 0 is the live package. */
  get queue(): readonly number[] {
    return this.queueIds;
  }

  /** Package on the front of the belt, or null when the belt is empty. */
  get current(): number | null {
    return this.queueIds[0] ?? null;
  }

  get placements(): Placement[] {
    return this.board.list;
  }

  get evaluation(): BoardEval {
    return this.evalCache;
  }

  /** Hazard state as of the last tick. */
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
    return this.phaseValue === 'play' && this.undoLeftValue > 0 && this.undoFrame !== null;
  }

  get outcome(): ShipmentOutcome | null {
    return this.outcomeValue;
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

  /** Ids the player may pick up right now. */
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
    const willCrush = evaluation.crushed.length > 0;
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
   * player is still holding something.
   */
  hold(id: number): boolean {
    if (!this.isMovable(id)) return false;
    this.heldId = id;
    return true;
  }

  release() {
    this.heldId = null;
  }

  /** Atomically moves a package from the belt or a shelf to a shelf slot. */
  move(id: number, shelf: number, slot: number): MoveResult {
    if (this.phaseValue !== 'play') return { ok: false, rejection: 'not-playing' };
    if (!this.isMovable(id)) return { ok: false, rejection: 'not-movable' };
    const from = this.locationOf(id) as CargoLocation;
    this.heldId = null;

    if (from.at === 'shelf' && from.shelf === shelf && from.slot === slot) {
      return { ok: true, changed: false, from };
    }
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
    return { ok: true, changed: true, from };
  }

  /** Atomically takes a stowed package off its shelf and puts it at the front of the belt. */
  toBelt(id: number): MoveResult {
    if (this.phaseValue !== 'play') return { ok: false, rejection: 'not-playing' };
    const from = this.locationOf(id);
    if (!from) return { ok: false, rejection: 'not-movable' };
    this.heldId = null;
    if (from.at === 'belt') return { ok: true, changed: false, from };

    this.captureUndo();
    this.board.remove(id);
    this.queueIds.unshift(id);
    this.afterChange();
    return { ok: true, changed: true, from };
  }

  /**
   * Restores the board, the belt and the hazard clocks to how they were
   * before the last committed command. Consumes one undo; the assist is
   * recorded and never erased. Play time and refused drops are not rewound.
   */
  undo(): boolean {
    if (!this.canUndo || !this.undoFrame) return false;
    const f = this.undoFrame;
    this.undoFrame = null;
    this.undoLeftValue--;
    this.assistsValue.undos++;
    this.heldId = null;
    this.board.clear();
    for (const p of f.placements) this.board.place(p.id, p.type, p.shelf, p.slot);
    this.queueIds = [...f.queue];
    this.hazards.restore(f.hazards);
    this.winSettleMs = 0;
    this.evalCache = this.board.evaluate();
    return true;
  }

  /**
   * Solver hint for the live package. Counts as an assist only when the
   * solver has an answer.
   */
  hint(): Hint | null {
    const current = this.current;
    if (this.phaseValue !== 'play' || current === null) return null;
    const hint = hintFor(this.level, this.board.list, [...this.queueIds], current);
    if (hint.kind !== 'stuck') this.assistsValue.hints++;
    return hint;
  }

  pause(): boolean {
    if (this.phaseValue !== 'play') return false;
    this.phaseValue = 'paused';
    this.heldId = null;
    return true;
  }

  resume(): boolean {
    if (this.phaseValue !== 'paused') return false;
    this.phaseValue = 'play';
    return true;
  }

  /** Advances the active-play clock and the hazard clocks. No-op unless playing. */
  tick(dtMs: number): TickResult {
    if (this.phaseValue !== 'play' || !(dtMs > 0)) {
      return { hazard: this.phaseValue === 'play' ? this.lastHazard : IDLE_HAZARD, outcome: null };
    }
    this.activeMsValue += dtMs;
    const hz = this.hazards.update(this.evalCache, dtMs);
    this.lastHazard = hz;

    if (hz.kind) {
      this.dangerMsValue += dtMs;
      this.winSettleMs = 0;
      if (hz.expired) return { hazard: hz, outcome: this.finish('failed', this.failureFacts(hz)) };
      return { hazard: hz, outcome: null };
    }

    if (this.canFinish && this.heldId === null) {
      this.winSettleMs += dtMs;
      if (this.winSettleMs >= WIN_SETTLE_MS) return { hazard: hz, outcome: this.finish('won') };
    } else {
      this.winSettleMs = 0;
    }
    return { hazard: hz, outcome: null };
  }

  // ==========================================================================
  // Snapshots
  // ==========================================================================

  snapshot(): ShipmentSnapshot {
    return {
      v: 1,
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
      outcome: this.outcomeValue ? structuredCloneOutcome(this.outcomeValue) : null,
    };
  }

  /**
   * Rebuilds a session from a snapshot. A shipment that was being played
   * comes back paused - resuming is always the player's decision.
   */
  static restore(level: LevelDef, snap: ShipmentSnapshot): GameSession {
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
    s.assistsValue = { ...snap.assists };
    s.rejected = snap.rejectedDrops;
    s.undoFrame = snap.undo ? cloneFrame(snap.undo) : null;
    s.outcomeValue = snap.outcome ? structuredCloneOutcome(snap.outcome) : null;
    s.evalCache = s.board.evaluate();
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
    this.evalCache = this.board.evaluate();
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
    this.heldId = null;
    this.undoFrame = null;
    const outcome: ShipmentOutcome = {
      result,
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
    return outcome;
  }
}

function cloneFrame(f: UndoFrame): UndoFrame {
  return {
    placements: f.placements.map((p) => ({ ...p })),
    queue: [...f.queue],
    hazards: {
      balance: f.hazards.balance,
      overload: f.hazards.overload.map(([a, b]) => [a, b] as [number, number]),
      fragile: f.hazards.fragile.map(([a, b]) => [a, b] as [number, number]),
    },
  };
}

function structuredCloneOutcome(o: ShipmentOutcome): ShipmentOutcome {
  return JSON.parse(JSON.stringify(o)) as ShipmentOutcome;
}

/** Every package is either on the belt or on a legal, non-overlapping slot - exactly once. */
function isConsistent(level: LevelDef, snap: ShipmentSnapshot): boolean {
  const n = level.packages.length;
  const seen = new Set<number>();
  for (const id of snap.queue) {
    if (!Number.isInteger(id) || id < 0 || id >= n || seen.has(id)) return false;
    seen.add(id);
  }
  const board = new PlacementSystem(level);
  for (const p of snap.placements) {
    if (!Number.isInteger(p.id) || p.id < 0 || p.id >= n || seen.has(p.id)) return false;
    if (p.type !== level.packages[p.id]) return false;
    if (board.check(p.type, p.shelf, p.slot, p.id)) return false;
    board.place(p.id, p.type, p.shelf, p.slot);
    seen.add(p.id);
  }
  if (seen.size !== n) return false;
  if (snap.undo) {
    const u = snap.undo;
    if (u.placements.length + u.queue.length !== n) return false;
  }
  return Number.isFinite(snap.activeMs) && Number.isFinite(snap.hazards.balance);
}
