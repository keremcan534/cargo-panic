/**
 * Endless run state and scoring.
 *
 * A run is a sequence of generated waves. Clearing a wave dispatches the
 * shipment, banks a score, and rolls the next (harder) rack. A hazard timer
 * running out ends the run - there are no lives, which is what makes the grace
 * periods feel like the real currency of the mode.
 */

import { randomSeed } from './Rng';

export interface RunState {
  seed: number;
  wave: number;
  score: number;
  /** Packages stowed across the whole run, for the results screen. */
  stowed: number;
  /** Waves cleared without a single rejected drop. */
  cleanWaves: number;
}

export function newRun(seed = randomSeed()): RunState {
  return { seed, wave: 1, score: 0, stowed: 0, cleanWaves: 0 };
}

/**
 * `?seed=12345` starts Endless on a fixed seed. Waves are deterministic, so
 * that makes a run reproducible - handy for comparing scores on the same
 * shift, and for replaying one that went wrong.
 */
export function seedFromUrl(): number | undefined {
  try {
    const raw = new URLSearchParams(window.location.search).get('seed');
    if (!raw) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    return Math.abs(Math.floor(n)) >>> 0;
  } catch {
    return undefined;
  }
}

/** Short display form of a run seed. */
export function formatSeed(seed: number): string {
  return seed.toString(36).toUpperCase();
}

export const SCORE = {
  /** Per unit of weight stowed. */
  perWeight: 10,
  /** Flat bonus per shipment, scaled by wave. */
  shipmentBase: 100,
  /** Awarded on a sliding scale for how level the rack finished. */
  balanceMax: 200,
  /** Dead level. */
  perfect: 150,
  /** No rejected drops and no hint during the wave. */
  clean: 100,
} as const;

export interface ScoreLine {
  label: string;
  value: number;
}

export interface WaveResult {
  lines: ScoreLine[];
  total: number;
  perfect: boolean;
  clean: boolean;
}

/** Scores one cleared wave. Pure, so the results panel and the run agree. */
export function scoreWave(opts: {
  wave: number;
  manifestWeight: number;
  imbalance: number;
  tolerance: number;
  mistakes: number;
  hintUsed: boolean;
}): WaveResult {
  const lines: ScoreLine[] = [];

  const cargo = opts.manifestWeight * SCORE.perWeight;
  lines.push({ label: 'CARGO STOWED', value: cargo });

  const shipment = SCORE.shipmentBase * opts.wave;
  lines.push({ label: `SHIPMENT x${opts.wave}`, value: shipment });

  const accuracy = Math.max(0, 1 - opts.imbalance / Math.max(opts.tolerance, 0.001));
  const balance = Math.round(SCORE.balanceMax * accuracy);
  lines.push({ label: 'BALANCE', value: balance });

  const perfect = opts.imbalance < 0.005;
  if (perfect) lines.push({ label: 'DEAD LEVEL', value: SCORE.perfect });

  const clean = opts.mistakes === 0 && !opts.hintUsed;
  if (clean) lines.push({ label: 'NO FUMBLES', value: SCORE.clean });

  const total = lines.reduce((n, l) => n + l.value, 0);
  return { lines, total, perfect, clean };
}

/** Compact display form: 12480 -> "12,480". */
export function formatScore(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
