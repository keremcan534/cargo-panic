/**
 * Save file v2: the persisted shape, its defaults, and a sanitiser that turns
 * untrusted JSON into a well-formed save or reports that it cannot.
 *
 * Nothing here touches storage; see SaveStore.ts.
 */

import type { ShipmentSnapshot } from '../session/types';
import type { RunState } from '../systems/RunManager';

export const SAVE_VERSION = 2;

export type RenderModePref = '2d' | '3d';
export type QualityPref = 'auto' | 'low' | 'high';
export type LanguagePref = 'en' | 'tr';

export interface Settings {
  sound: boolean;
  haptics: boolean;
  renderMode: RenderModePref;
  quality: QualityPref;
  /** null = follow the system `prefers-reduced-motion` setting. */
  reducedMotion: boolean | null;
  /** null = follow the device language. */
  language: LanguagePref | null;
}

export interface EndlessRecord {
  bestScore: number;
  bestWave: number;
  runs: number;
}

export interface CampaignProgress {
  unlocked: number;
  /** levelId -> best stars (0-3). Never lowered. */
  stars: Record<number, number>;
  /** levelId -> lowest finishing imbalance. */
  bestBalance: Record<number, number>;
}

export interface TutorialState {
  /** Tutorial step ids the player has completed. */
  done: string[];
  skipped: boolean;
  /** Cargo types whose first-encounter explainer has been shown. */
  seenCargo: string[];
}

/** An Endless run that can be resumed (same shape as RunManager.RunState). */
export type SavedRun = RunState;

export type ActivePlay =
  | {
      kind: 'campaign';
      levelId: number;
      rulesetVersion: number;
      shipment: ShipmentSnapshot;
    }
  | {
      kind: 'endless';
      rulesetVersion: number;
      generatorVersion: number;
      run: SavedRun;
      /** Null between waves (the next wave has not been dealt yet). */
      shipment: ShipmentSnapshot | null;
    };

export interface SaveData {
  settings: Settings;
  campaign: CampaignProgress;
  /** Endless records keyed by ruleset version, never mixed across rulesets. */
  endless: Record<string, EndlessRecord>;
  tutorial: TutorialState;
  /** Reward ids already granted; a claim with a listed id is a no-op. */
  claimed: string[];
  active: ActivePlay | null;
}

/** Most recent reward ids kept. Old runs cannot be resumed, so their ids expire safely. */
export const CLAIMED_LIMIT = 400;

export function blankSave(): SaveData {
  return {
    settings: {
      sound: true,
      haptics: true,
      renderMode: '3d',
      quality: 'auto',
      reducedMotion: null,
      language: null,
    },
    campaign: { unlocked: 1, stars: {}, bestBalance: {} },
    endless: {},
    tutorial: { done: [], skipped: false, seenCargo: [] },
    claimed: [],
    active: null,
  };
}

// ---------------------------------------------------------------------------
// Sanitising
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown, lo: number, hi: number, dflt: number) =>
  num(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : dflt;

export function sanitizeCampaign(raw: unknown, totalLevels: number): CampaignProgress {
  const out: CampaignProgress = { unlocked: 1, stars: {}, bestBalance: {} };
  if (!isObj(raw)) return out;
  out.unlocked = int(raw.unlocked, 1, totalLevels, 1);
  if (isObj(raw.stars)) {
    for (const [k, v] of Object.entries(raw.stars)) {
      const id = Number(k);
      if (Number.isInteger(id) && id >= 1 && id <= totalLevels && num(v)) out.stars[id] = int(v, 0, 3, 0);
    }
  }
  if (isObj(raw.bestBalance)) {
    for (const [k, v] of Object.entries(raw.bestBalance)) {
      const id = Number(k);
      if (Number.isInteger(id) && id >= 1 && id <= totalLevels && num(v) && v >= 0) out.bestBalance[id] = v;
    }
  }
  return out;
}

export function sanitizeEndlessRecord(raw: unknown): EndlessRecord | null {
  if (!isObj(raw)) return null;
  return {
    bestScore: int(raw.bestScore, 0, Number.MAX_SAFE_INTEGER, 0),
    bestWave: int(raw.bestWave, 0, 1_000_000, 0),
    runs: int(raw.runs, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

function sanitizeSettings(raw: unknown): Settings {
  const d = blankSave().settings;
  if (!isObj(raw)) return d;
  return {
    sound: typeof raw.sound === 'boolean' ? raw.sound : d.sound,
    haptics: typeof raw.haptics === 'boolean' ? raw.haptics : d.haptics,
    renderMode: raw.renderMode === '2d' || raw.renderMode === '3d' ? raw.renderMode : d.renderMode,
    quality: raw.quality === 'low' || raw.quality === 'high' || raw.quality === 'auto' ? raw.quality : d.quality,
    reducedMotion: typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : null,
    language: raw.language === 'en' || raw.language === 'tr' ? raw.language : null,
  };
}

const strList = (v: unknown, limit: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-limit) : [];

function sanitizeRun(raw: unknown): SavedRun | null {
  if (!isObj(raw) || typeof raw.runId !== 'string' || !num(raw.seed) || !num(raw.wave)) return null;
  const wave = int(raw.wave, 1, 1_000_000, 1);
  return {
    runId: raw.runId,
    seed: raw.seed >>> 0,
    wave,
    score: int(raw.score, 0, Number.MAX_SAFE_INTEGER, 0),
    stowed: int(raw.stowed, 0, Number.MAX_SAFE_INTEGER, 0),
    cleanWaves: int(raw.cleanWaves, 0, Number.MAX_SAFE_INTEGER, 0),
    assisted: raw.assisted === true,
    rewardedThrough: int(raw.rewardedThrough, 0, wave, 0),
  };
}

/** Structural check only; GameSession.restore does the deep validation against the level. */
function looksLikeShipment(v: unknown): v is ShipmentSnapshot {
  return (
    isObj(v) &&
    v.v === 1 &&
    isObj(v.source) &&
    Array.isArray(v.placements) &&
    Array.isArray(v.queue) &&
    isObj(v.hazards) &&
    isObj(v.assists) &&
    typeof v.levelFingerprint === 'string'
  );
}

function sanitizeActive(raw: unknown): ActivePlay | null {
  if (!isObj(raw)) return null;
  if (raw.kind === 'campaign') {
    if (!num(raw.levelId) || !num(raw.rulesetVersion) || !looksLikeShipment(raw.shipment)) return null;
    const src = raw.shipment.source as { mode?: unknown; levelId?: unknown };
    if (src.mode !== 'campaign' || src.levelId !== raw.levelId) return null;
    return { kind: 'campaign', levelId: raw.levelId, rulesetVersion: raw.rulesetVersion, shipment: raw.shipment };
  }
  if (raw.kind === 'endless') {
    const run = sanitizeRun(raw.run);
    if (!run || !num(raw.rulesetVersion) || !num(raw.generatorVersion)) return null;
    const shipment = raw.shipment === null ? null : looksLikeShipment(raw.shipment) ? raw.shipment : undefined;
    if (shipment === undefined) return null;
    // The run and the shipment must describe the same wave of the same shift.
    if (shipment) {
      const src = shipment.source as { mode?: unknown; runId?: unknown; seed?: unknown; wave?: unknown };
      if (src.mode !== 'endless' || src.runId !== run.runId || src.seed !== run.seed || src.wave !== run.wave) {
        return null;
      }
      if (run.rewardedThrough >= run.wave) return null;
    }
    return {
      kind: 'endless',
      rulesetVersion: raw.rulesetVersion,
      generatorVersion: raw.generatorVersion,
      run,
      shipment,
    };
  }
  return null;
}

/**
 * Turns parsed v2 JSON into a SaveData, or null when the payload is not a v2
 * save at all. Individual bad fields fall back to defaults; an unusable
 * active run is dropped (and reported by the caller), never the progress.
 */
export function sanitizeV2(raw: unknown, totalLevels: number): { data: SaveData; droppedActive: boolean } | null {
  if (!isObj(raw)) return null;
  const endless: Record<string, EndlessRecord> = {};
  if (isObj(raw.endless)) {
    for (const [k, v] of Object.entries(raw.endless)) {
      const r = sanitizeEndlessRecord(v);
      if (r && /^\d+$/.test(k)) endless[k] = r;
    }
  }
  const tut = isObj(raw.tutorial) ? raw.tutorial : {};
  const active = raw.active === null || raw.active === undefined ? null : sanitizeActive(raw.active);
  return {
    data: {
      settings: sanitizeSettings(raw.settings),
      campaign: sanitizeCampaign(raw.campaign, totalLevels),
      endless,
      tutorial: {
        done: strList(tut.done, 64),
        skipped: tut.skipped === true,
        seenCargo: strList(tut.seenCargo, 16),
      },
      claimed: strList(raw.claimed, CLAIMED_LIMIT),
      active,
    },
    droppedActive: raw.active !== null && raw.active !== undefined && active === null,
  };
}

/**
 * v1 -> v2. Every v1 field has a home: stars, best balance, unlock, sound and
 * vibration carry over; the v1 Endless best becomes the ruleset-1 record.
 */
export function migrateV1(raw: unknown, totalLevels: number): SaveData {
  const d = blankSave();
  if (!isObj(raw)) return d;
  d.campaign = sanitizeCampaign(raw, totalLevels);
  if (typeof raw.sound === 'boolean') d.settings.sound = raw.sound;
  if (typeof raw.haptics === 'boolean') d.settings.haptics = raw.haptics;
  const e = sanitizeEndlessRecord(raw.endless);
  if (e) d.endless['1'] = e;
  return d;
}
