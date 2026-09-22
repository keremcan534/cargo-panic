/**
 * Serializable shapes of a shipment in progress. Everything here is plain data
 * - no three.js, no DOM - so the same values drive both renderers, the undo
 * stack, view switches and saved runs.
 */

import type { LevelDef } from '../levels/types';
import type { BoardEval, Placement, PlaceRejection } from '../systems/BalanceSystem';
import type { HazardKind, HazardSnapshot, HazardState } from '../systems/HazardSystem';

/** Where a shipment's rack and manifest came from. Enough to rebuild the level. */
export type ShipmentSource =
  | { mode: 'campaign'; levelId: number }
  | { mode: 'endless'; runId: string; seed: number; wave: number };

/**
 * `play`   - clocks run, commands are accepted.
 * `paused` - nothing moves; commands are refused.
 * `won` / `failed` - terminal; the outcome is fixed.
 */
export type SessionPhase = 'play' | 'paused' | 'won' | 'failed';

/** Help the player took this shipment. Never decreases. */
export interface Assists {
  hints: number;
  undos: number;
}

/** Where a package is, from the rules' point of view. */
export type CargoLocation = { at: 'belt'; index: number } | { at: 'shelf'; shelf: number; slot: number };

export interface SlotTarget {
  shelf: number;
  slot: number;
}

/** Board + clocks captured before a committed command, for a one-step undo. */
export interface UndoFrame {
  placements: Placement[];
  queue: number[];
  hazards: HazardSnapshot;
}

export type FailureFacts =
  | { kind: 'balance'; imbalance: number; tolerance: number; net: number }
  | { kind: 'overload'; tier: number; load: number; max: number }
  | { kind: 'fragile'; fragileId: number; crusherIds: number[] };

export interface ShipmentOutcome {
  result: 'won' | 'failed';
  /** The shipment this outcome belongs to - a reward is only ever paid to that run and wave. */
  source: ShipmentSource;
  /** Ruleset the shipment was played and judged under. */
  ruleset: number;
  /** Final committed board. */
  placements: Placement[];
  imbalance: number;
  /** Imbalance limit the finish was judged against. */
  limit: number;
  assists: Assists;
  /** Refused drop attempts. Counted for analytics; see rules.ts for scoring use. */
  rejectedDrops: number;
  /** Milliseconds any hazard clock was draining on the committed board. */
  dangerMs: number;
  activeMs: number;
  failure?: FailureFacts;
}

/** Everything needed to resume a shipment exactly. JSON-safe. */
export interface ShipmentSnapshot {
  v: 1;
  /** Ruleset and generator the shipment was played under; restore refuses a mismatch. */
  ruleset: number;
  generator: number;
  source: ShipmentSource;
  /** Guards against resuming onto a level whose data has since changed. */
  levelFingerprint: string;
  graceScale: number;
  phase: SessionPhase;
  placements: Placement[];
  queue: number[];
  hazards: HazardSnapshot;
  winSettleMs: number;
  activeMs: number;
  dangerMs: number;
  assists: Assists;
  rejectedDrops: number;
  undoLeft: number;
  undo: UndoFrame | null;
  outcome: ShipmentOutcome | null;
}

export type MoveResult =
  | { ok: true; changed: boolean; from: CargoLocation }
  | { ok: false; rejection: PlaceRejection | 'not-playing' | 'not-movable' };

export type TargetKind = 'ok' | 'crush' | 'bad';

/** What dropping a package on a target would do. Pure preview; nothing changes. */
export interface TargetPreview {
  kind: TargetKind;
  rejection: PlaceRejection | null;
  /** Board after the hypothetical move (null when rejected). */
  evaluation: BoardEval | null;
  willCrush: boolean;
  willOverload: boolean;
}

export interface TickResult {
  hazard: HazardState;
  /** Set on the tick the shipment ends. */
  outcome: ShipmentOutcome | null;
}

export type { HazardKind, LevelDef };
