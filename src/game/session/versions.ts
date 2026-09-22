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

export const RULESET_VERSION = 1;
export const GENERATOR_VERSION = 1;
