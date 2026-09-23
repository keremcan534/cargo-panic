/**
 * The resumable game, into and out of the save.
 *
 * - `newShipment` builds the shipment a game screen plays: a campaign level,
 *   or the run's current Endless wave.
 * - `activeFrom` turns the live shipment and (Endless) its run, captured at
 *   the same moment, into the save's `active` entry - so the two always
 *   describe the same wave of the same shift.
 * - `bankWave` pays a cleared Endless wave, moves the run to the next wave
 *   and writes the new `active` as ONE reward claim: the save holds all
 *   three or none of them.
 * - `resumeActive` rebuilds a saved game, paused, or says why it cannot.
 *
 * No DOM and no storage of its own: saving goes through the ledger passed
 * in (the app's ProgressManager).
 */

import { getWave } from '../game/levels/generator';
import { getLevel, TOTAL_LEVELS } from '../game/levels/levels';
import type { LevelDef } from '../game/levels/types';
import type { ActivePlay } from '../game/save/schema';
import {
  GameSession,
  GENERATOR_VERSION,
  nextWave,
  rewardWave,
  RULESET_VERSION,
  SessionRestoreError,
  shipmentScore,
  waveRewardId,
  waveSource,
} from '../game/session';
import type { ShipmentOutcome, ShipmentSnapshot, ShipmentSource } from '../game/session';
import type { Progress } from '../game/systems/ProgressManager';
import type { RunState, WaveResult } from '../game/systems/RunManager';

/** One free undo per shipment (campaign level or Endless wave); a new wave is a new session. */
export const UNDO_PER_SHIPMENT = 1;

/** A shipment ready for the game screen. */
export interface Shipment {
  level: LevelDef;
  /** Hazard grace multiplier (Endless shortens it). */
  graceScale: number;
  session: GameSession;
  /** The Endless run the shipment belongs to (the same object the screen updates), or null. */
  run: RunState | null;
  /** The session came back from a saved snapshot (false: newly dealt). */
  restored: boolean;
}

/** The parts of ProgressManager a wave reward goes through. */
export type RewardLedger = Pick<Progress, 'claim' | 'setActive' | 'active'>;

const finished = (s: GameSession) => s.phase === 'won' || s.phase === 'failed';

/** The shipment is the run's current wave and that wave has not been rewarded. */
function isCurrentWave(src: ShipmentSource, run: RunState): boolean {
  return (
    src.mode === 'endless' &&
    src.runId === run.runId &&
    src.seed === run.seed &&
    src.wave === run.wave &&
    run.rewardedThrough < run.wave
  );
}

/** A campaign level, or the run's current wave, newly dealt. `startPaused`: dealt while the app is hidden, or resumed. */
export function newShipment(start: { levelId: number } | { run: RunState }, startPaused = false): Shipment {
  if ('run' in start) {
    const run = start.run;
    const plan = getWave(run.seed, run.wave);
    const session = new GameSession(plan.level, {
      source: waveSource(run),
      graceScale: plan.graceScale,
      undoAllowance: UNDO_PER_SHIPMENT,
      startPaused,
    });
    return { level: plan.level, graceScale: plan.graceScale, session, run, restored: false };
  }
  const level = getLevel(start.levelId);
  const session = new GameSession(level, {
    source: { mode: 'campaign', levelId: level.id },
    undoAllowance: UNDO_PER_SHIPMENT,
    startPaused,
  });
  return { level, graceScale: 1, session, run: null, restored: false };
}

/**
 * The save's `active` entry for a game in progress, or null when there is
 * nothing to resume.
 *
 * Campaign: the session's snapshot. Endless: a copy of the run, with the
 * session's snapshot when the session is the run's current, unrewarded
 * wave - otherwise shipment null, "the next wave has not been dealt" (pass
 * session null after bankWave). A finished shipment is never resumable:
 * a finished campaign level or a finished current wave give null, and
 * callers never write that over what the outcome itself saved.
 */
export function activeFrom(session: GameSession | null, run: RunState | null): ActivePlay | null {
  if (!run) {
    if (!session || session.source.mode !== 'campaign' || finished(session)) return null;
    return {
      kind: 'campaign',
      levelId: session.source.levelId,
      rulesetVersion: RULESET_VERSION,
      shipment: session.snapshot(),
    };
  }
  let shipment: ShipmentSnapshot | null = null;
  if (session && isCurrentWave(session.source, run)) {
    if (finished(session)) return null;
    shipment = session.snapshot();
  }
  return {
    kind: 'endless',
    rulesetVersion: RULESET_VERSION,
    generatorVersion: GENERATOR_VERSION,
    run: { ...run },
    shipment,
  };
}

export interface BankedWave {
  /** The reward was paid now. False: the save already had it; nothing was paid twice. */
  paid: boolean;
  /** Score lines of the cleared wave. */
  result: WaveResult;
  /** The wave that was cleared (the run is on the next one now). */
  wave: number;
}

/**
 * A cleared Endless wave: the reward, the move to the next wave and the new
 * `active` (the run, next wave not dealt yet) are one claim of the wave's
 * reward id - written together or not at all. `run` is updated in place;
 * the on-screen score reads it. A repeated outcome, a double tap or a resumed
 * snapshot never pays twice: the claim id and `run.rewardedThrough` both
 * refuse it.
 *
 * Returns null (and changes nothing) unless the outcome is a win of the
 * run's current, unrewarded wave.
 */
export function bankWave(
  ledger: RewardLedger,
  run: RunState,
  level: LevelDef,
  outcome: ShipmentOutcome,
): BankedWave | null {
  if (outcome.result !== 'won' || !isCurrentWave(outcome.source, run)) return null;
  const wave = run.wave;
  const result = shipmentScore(level, wave, outcome);
  const paid = ledger.claim(waveRewardId(run), (d) => {
    rewardWave(run, level, outcome);
    nextWave(run);
    d.active = activeFrom(null, run);
  });
  if (!paid) settleStaleRun(ledger, run, wave);
  return { paid, result, wave };
}

/**
 * The save already holds `wave`'s reward, so `run` is an older copy of the
 * run. Nothing is paid again: the copy catches up with the saved run when
 * the save has it, otherwise it just moves on to the next wave.
 */
function settleStaleRun(ledger: RewardLedger, run: RunState, wave: number) {
  const saved = ledger.active;
  if (saved?.kind === 'endless' && saved.run.runId === run.runId && saved.run.rewardedThrough >= wave) {
    Object.assign(run, saved.run);
    return;
  }
  run.rewardedThrough = wave;
  nextWave(run);
  ledger.setActive(activeFrom(null, run));
}

/** Why a saved game cannot be continued (SessionRestoreError codes). */
export type ResumeFailure = SessionRestoreError['code'];

export type ResumeResult = { ok: true; shipment: Shipment } | { ok: false; reason: ResumeFailure };

/**
 * Rebuilds the saved game, paused - resuming is always the player's call.
 * Campaign: the level and its restored shipment. Endless: the run's wave
 * from its seed (same ruleset and generator only) with its restored
 * shipment, or - when the wave had not been dealt - that wave newly dealt,
 * paused. Anything that cannot be rebuilt exactly is refused with a reason;
 * the caller tells the player and keeps every record.
 */
export function resumeActive(a: ActivePlay): ResumeResult {
  try {
    return { ok: true, shipment: rebuild(a) };
  } catch (e) {
    return { ok: false, reason: e instanceof SessionRestoreError ? e.code : 'corrupt' };
  }
}

function rebuild(a: ActivePlay): Shipment {
  if (a.rulesetVersion !== RULESET_VERSION) throw new SessionRestoreError('unsupported');
  if (a.kind === 'campaign') {
    if (!Number.isInteger(a.levelId) || a.levelId < 1 || a.levelId > TOTAL_LEVELS) {
      throw new SessionRestoreError('corrupt');
    }
    const level = getLevel(a.levelId);
    const session = restorePaused(level, a.shipment);
    return { level, graceScale: session.graceScale, session, run: null, restored: true };
  }
  if (a.generatorVersion !== GENERATOR_VERSION) throw new SessionRestoreError('unsupported');
  const run: RunState = { ...a.run };
  // A rewarded wave has always been left for the next one.
  if (run.rewardedThrough >= run.wave) throw new SessionRestoreError('corrupt');
  if (!a.shipment) return newShipment({ run }, true);
  const plan = getWave(run.seed, run.wave);
  const session = restorePaused(plan.level, a.shipment);
  if (!isCurrentWave(session.source, run)) throw new SessionRestoreError('corrupt');
  return { level: plan.level, graceScale: session.graceScale, session, run, restored: true };
}

/** A saved shipment is always one in progress; restore brings it back paused. */
function restorePaused(level: LevelDef, snap: ShipmentSnapshot): GameSession {
  const s = GameSession.restore(level, snap);
  if (s.phase !== 'paused') throw new SessionRestoreError('corrupt');
  return s;
}
