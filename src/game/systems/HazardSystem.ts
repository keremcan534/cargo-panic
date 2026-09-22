/**
 * The grace-period clocks.
 *
 * Three things can fail a level - too much imbalance, an overloaded shelf, and
 * fragile cargo being crushed - and all three work the same way: while the
 * condition holds, a timer drains; the moment the player fixes it, the timer
 * refills. Nothing in Cargo Panic fails instantly.
 */

import { CRITICAL_RATIO, GRACE_MS } from '../config';
import type { LevelDef } from '../levels/types';
import type { BoardEval } from './BalanceSystem';

export type HazardKind = 'balance' | 'overload' | 'fragile';

export interface HazardState {
  /** The most urgent active hazard, or null when the rack is happy. */
  kind: HazardKind | null;
  /** Milliseconds left before this hazard fails the level. */
  remaining: number;
  /** Full duration of that grace period, for drawing the countdown bar. */
  total: number;
  /** Shelf tier for 'overload', package id for 'fragile', otherwise -1. */
  owner: number;
  /** 0 at the moment the hazard appears, 1 when the timer runs out. */
  urgency: number;
  /** True on the frame the timer hits zero. */
  expired: boolean;
}

/** Serializable clock state, for undo, view switches and saved runs. */
export interface HazardSnapshot {
  balance: number;
  /** [tier, ms left] for every overloaded shelf. */
  overload: [number, number][];
  /** [package id, ms left] for every crushed fragile crate. */
  fragile: [number, number][];
}

const CLEAR: HazardState = Object.freeze({
  kind: null,
  remaining: 0,
  total: 1,
  owner: -1,
  urgency: 0,
  expired: false,
});

export class HazardSystem {
  private readonly grace: { balance: number; overload: number; fragile: number };
  private balance: number;
  private overload = new Map<number, number>();
  private fragile = new Map<number, number>();

  /**
   * `graceScale` shortens every countdown. Endless mode uses it to keep the
   * pressure rising once package count and tolerance have bottomed out.
   */
  constructor(
    private level: LevelDef,
    graceScale = 1,
  ) {
    const s = Math.max(0.3, Math.min(1, graceScale));
    this.grace = {
      balance: GRACE_MS.balance * s,
      overload: GRACE_MS.overload * s,
      fragile: GRACE_MS.fragile * s,
    };
    this.balance = this.grace.balance;
  }

  reset() {
    this.balance = this.grace.balance;
    this.overload.clear();
    this.fragile.clear();
  }

  snapshot(): HazardSnapshot {
    return {
      balance: this.balance,
      overload: [...this.overload.entries()],
      fragile: [...this.fragile.entries()],
    };
  }

  /** Restores clocks, never granting more than a full grace period. */
  restore(s: HazardSnapshot) {
    this.balance = Math.min(this.grace.balance, s.balance);
    this.overload = new Map(s.overload.map(([k, v]) => [k, Math.min(this.grace.overload, v)]));
    this.fragile = new Map(s.fragile.map(([k, v]) => [k, Math.min(this.grace.fragile, v)]));
  }

  /**
   * The state update(ev, 0) would report, without touching any clock. Used to
   * show the right countdown while paused, after a restore and after undo.
   */
  peek(ev: BoardEval): HazardState {
    const overload: [number, number][] = [];
    for (const [t, left] of this.overload) if (ev.overloaded.includes(t)) overload.push([t, left]);
    for (const t of ev.overloaded) if (!this.overload.has(t)) overload.push([t, this.grace.overload]);
    const fragile: [number, number][] = [];
    for (const [id, left] of this.fragile) if (ev.crushed.includes(id)) fragile.push([id, left]);
    for (const id of ev.crushed) if (!this.fragile.has(id)) fragile.push([id, this.grace.fragile]);
    return this.select(ev.status === 'danger', this.balance, overload, fragile);
  }

  /** Advances every clock and reports the one closest to failing. */
  update(ev: BoardEval, deltaMs: number): HazardState {
    const tol = this.level.balanceTolerance;

    // Imbalance well past the red line burns the clock twice as fast.
    if (ev.status === 'danger') {
      this.balance -= deltaMs * (ev.imbalance > tol * CRITICAL_RATIO ? 2 : 1);
    } else {
      this.balance = this.grace.balance;
    }

    for (let t = 0; t < this.level.shelves.length; t++) {
      if (ev.overloaded.includes(t)) {
        this.overload.set(t, (this.overload.get(t) ?? this.grace.overload) - deltaMs);
      } else {
        this.overload.delete(t);
      }
    }

    for (const id of [...this.fragile.keys()]) {
      if (!ev.crushed.includes(id)) this.fragile.delete(id);
    }
    for (const id of ev.crushed) {
      this.fragile.set(id, (this.fragile.get(id) ?? this.grace.fragile) - deltaMs);
    }

    return this.select(ev.status === 'danger', this.balance, this.overload, this.fragile);
  }

  private select(
    balanceDanger: boolean,
    balance: number,
    overload: Iterable<[number, number]>,
    fragile: Iterable<[number, number]>,
  ): HazardState {
    let kind: HazardKind | null = null;
    let remaining = Infinity;
    let total = 1;
    let owner = -1;

    if (balanceDanger) {
      kind = 'balance';
      remaining = balance;
      total = this.grace.balance;
    }
    for (const [tier, left] of overload) {
      if (left < remaining) {
        kind = 'overload';
        remaining = left;
        total = this.grace.overload;
        owner = tier;
      }
    }
    for (const [id, left] of fragile) {
      if (left < remaining) {
        kind = 'fragile';
        remaining = left;
        total = this.grace.fragile;
        owner = id;
      }
    }

    if (!kind) return CLEAR;

    return {
      kind,
      remaining,
      total,
      owner,
      urgency: Math.min(1, Math.max(0, 1 - remaining / total)),
      expired: remaining <= 0,
    };
  }

  /** Full grace durations, for validating restored clocks. */
  get graceMs(): Readonly<{ balance: number; overload: number; fragile: number }> {
    return this.grace;
  }
}
