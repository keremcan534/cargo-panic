/**
 * Versions stamped on saves, records and (later) challenge codes.
 *
 * RULESET_VERSION covers anything that changes how a finished shipment is
 * judged: stars, score lines, hazard timings. Records made under one ruleset
 * are never silently compared with another.
 *
 * GENERATOR_VERSION covers anything that changes which rack a (seed, wave)
 * produces. A saved Endless run can only resume under the generator that
 * built it.
 */

/**
 * 1 - original game: refused drops cost stars and the clean bonus.
 * 2 - Phase A: refused drops cost nothing; undo exists and voids only the
 *     Endless clean bonus; picking cargo up no longer changes the board.
 */
export const RULESET_VERSION = 2;
export const GENERATOR_VERSION = 1;
