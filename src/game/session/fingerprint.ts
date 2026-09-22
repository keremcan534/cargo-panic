/**
 * Short stable hash of a level's rules-relevant data, so a saved shipment can
 * tell whether the level it was played on still exists unchanged.
 */

import type { LevelDef } from '../levels/types';

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function levelFingerprint(level: LevelDef): string {
  const canonical = JSON.stringify({
    shelves: level.shelves.map((s) => ({
      slots: s.slots,
      maxWeight: s.maxWeight,
      locked: !!s.locked,
      zone: s.zone ? [s.zone.from, s.zone.to] : null,
    })),
    packages: level.packages,
    balanceTolerance: level.balanceTolerance,
    finalBalanceMax: level.finalBalanceMax ?? null,
  });
  return fnv1a(canonical).toString(36);
}
