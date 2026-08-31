/**
 * The 25 hand-authored levels.
 *
 * Shelf index 0 is always the BOTTOM tier. Each tier above adds 25% leverage,
 * so the same crate placed higher pushes the rack harder. Every level in this
 * file is checked by `npm run validate`, which brute-forces a legal finishing
 * arrangement and also confirms a three-star (tight balance) finish exists.
 */

import type { LevelDef } from './types';

export const LEVELS: LevelDef[] = [
  // --- 1-3: drag, drop, and the idea that sides must match -------------------
  {
    id: 1,
    name: 'FIRST SHIPMENT',
    objective: 'Store both boxes',
    tip: 'Drag a box from the belt onto the shelf. Keep the two sides even.',
    shelves: [{ slots: 5, maxWeight: 14 }],
    packages: ['standard', 'standard'],
    balanceTolerance: 6,
  },
  {
    id: 2,
    name: 'EVEN LOAD',
    objective: 'Store all four boxes',
    tip: 'Distance from the middle matters as much as weight.',
    shelves: [{ slots: 5, maxWeight: 14 }],
    packages: ['standard', 'standard', 'standard', 'standard'],
    balanceTolerance: 5,
  },
  {
    id: 3,
    name: 'STACK UP',
    objective: 'Fill both shelves',
    tip: 'Higher shelves have more leverage. Watch the multiplier badge.',
    shelves: [
      { slots: 5, maxWeight: 10 },
      { slots: 5, maxWeight: 10 },
    ],
    packages: ['standard', 'standard', 'standard', 'standard', 'standard'],
    balanceTolerance: 4,
  },

  // --- 4-7: heavy crates and shelf tiers ------------------------------------
  {
    id: 4,
    name: 'HEAVY METAL',
    objective: 'Store two heavy crates',
    tip: 'A heavy crate weighs 5. One on its own will tip the rack.',
    shelves: [{ slots: 5, maxWeight: 14 }],
    packages: ['heavy', 'heavy', 'standard'],
    balanceTolerance: 6,
  },
  {
    id: 5,
    name: 'TOP SHELF',
    objective: 'Store everything within the load limits',
    tip: 'The upper shelf only takes 8. Heavy crates belong low.',
    shelves: [
      { slots: 5, maxWeight: 16 },
      { slots: 5, maxWeight: 8 },
    ],
    packages: ['heavy', 'standard', 'heavy', 'standard'],
    balanceTolerance: 6,
  },
  {
    id: 6,
    name: 'THREE TIERS',
    objective: 'Store all five packages',
    tip: 'Three tiers, three leverage multipliers.',
    shelves: [
      { slots: 5, maxWeight: 16 },
      { slots: 5, maxWeight: 10 },
      { slots: 5, maxWeight: 6 },
    ],
    packages: ['heavy', 'standard', 'standard', 'heavy', 'standard'],
    balanceTolerance: 5,
  },
  {
    id: 7,
    name: 'CRATE RUN',
    objective: 'Land three heavy crates safely',
    tip: 'The bottom shelf only takes 12. One crate has to go up.',
    shelves: [
      { slots: 7, maxWeight: 12 },
      { slots: 5, maxWeight: 10 },
    ],
    packages: ['heavy', 'heavy', 'standard', 'heavy', 'standard'],
    balanceTolerance: 5,
  },

  // --- 8-11: fragile cargo and the no-crush column rule ----------------------
  {
    id: 8,
    name: 'HANDLE WITH CARE',
    objective: 'Deliver both fragile crates intact',
    tip: 'Nothing heavy may sit in the column above a fragile crate.',
    shelves: [
      { slots: 5, maxWeight: 12 },
      { slots: 5, maxWeight: 12 },
    ],
    packages: ['fragile', 'heavy', 'fragile', 'standard'],
    balanceTolerance: 6,
  },
  {
    id: 9,
    name: 'GLASS FLOOR',
    objective: 'Store everything, break nothing',
    tip: 'Fragile crates weigh almost nothing - they barely help the balance.',
    shelves: [
      { slots: 5, maxWeight: 12 },
      { slots: 5, maxWeight: 10 },
      { slots: 5, maxWeight: 8 },
    ],
    packages: ['fragile', 'heavy', 'standard', 'fragile', 'heavy', 'standard'],
    balanceTolerance: 5,
  },
  {
    id: 10,
    name: 'COLUMN CHECK',
    objective: 'Keep every column crush-free',
    tip: 'Columns line up across shelves even when the shelves differ in width.',
    shelves: [
      { slots: 6, maxWeight: 14 },
      { slots: 6, maxWeight: 12 },
      { slots: 6, maxWeight: 8 },
    ],
    packages: ['fragile', 'heavy', 'standard', 'heavy', 'fragile', 'standard', 'standard'],
    balanceTolerance: 5,
  },
  {
    id: 11,
    name: 'DELICATE BALANCE',
    objective: 'Three fragile crates, two heavy ones',
    tip: 'Park the heavy crates first, then thread the glass around them.',
    shelves: [
      { slots: 5, maxWeight: 12 },
      { slots: 5, maxWeight: 10 },
      { slots: 5, maxWeight: 8 },
    ],
    packages: ['heavy', 'fragile', 'standard', 'fragile', 'heavy', 'fragile', 'standard'],
    balanceTolerance: 4,
  },

  // --- 12-15: long packages and horizontal space ----------------------------
  {
    id: 12,
    name: 'LONG HAUL',
    objective: 'Fit the long package',
    tip: 'A long package eats three slots. Centre it and it costs nothing.',
    shelves: [{ slots: 7, maxWeight: 16 }],
    packages: ['long', 'standard', 'standard'],
    balanceTolerance: 6,
  },
  {
    id: 13,
    name: 'DOUBLE LENGTH',
    objective: 'Store two long packages',
    tip: 'Two long packages cannot both be centred. Trade the offsets off.',
    shelves: [
      { slots: 7, maxWeight: 14 },
      { slots: 7, maxWeight: 12 },
    ],
    packages: ['long', 'standard', 'long', 'standard'],
    balanceTolerance: 5,
  },
  {
    id: 14,
    name: 'TIGHT FIT',
    objective: 'Squeeze all five in',
    tip: 'Space runs out before weight does.',
    shelves: [
      { slots: 7, maxWeight: 16 },
      { slots: 6, maxWeight: 10 },
    ],
    packages: ['long', 'heavy', 'long', 'heavy', 'standard'],
    balanceTolerance: 5,
  },
  {
    id: 15,
    name: 'SPACE SAVER',
    objective: 'Six packages, shrinking shelves',
    tip: 'Shelves get narrower as they climb. Plan the long ones first.',
    shelves: [
      { slots: 7, maxWeight: 16 },
      { slots: 6, maxWeight: 12 },
      { slots: 5, maxWeight: 8 },
    ],
    packages: ['long', 'standard', 'heavy', 'long', 'standard', 'standard'],
    balanceTolerance: 5,
  },

  // --- 16-19: load limits and marked destination zones ----------------------
  {
    id: 16,
    name: 'PRIORITY ONE',
    objective: 'Get the priority package into the gold zone',
    tip: 'Gold cargo only counts when it sits inside the gold zone.',
    shelves: [
      { slots: 5, maxWeight: 12 },
      { slots: 5, maxWeight: 12, zone: { from: 3, to: 5 } },
    ],
    packages: ['priority', 'standard', 'standard', 'standard'],
    balanceTolerance: 6,
  },
  {
    id: 17,
    name: 'GOLD ZONE',
    objective: 'Two priority packages, both in gold',
    tip: 'The zone is off-centre, so the rest of the rack has to compensate.',
    shelves: [
      { slots: 6, maxWeight: 12 },
      { slots: 6, maxWeight: 8, zone: { from: 0, to: 2 } },
      { slots: 6, maxWeight: 6 },
    ],
    packages: ['priority', 'heavy', 'priority', 'standard', 'standard'],
    balanceTolerance: 5,
  },
  {
    id: 18,
    name: 'LOAD LIMIT',
    objective: 'Finish under a 2.5 imbalance',
    tip: 'This one is scored tighter than the red line. Aim for dead level.',
    shelves: [
      { slots: 6, maxWeight: 12 },
      { slots: 6, maxWeight: 10 },
      { slots: 6, maxWeight: 8 },
    ],
    packages: ['heavy', 'standard', 'heavy', 'standard', 'standard', 'heavy'],
    balanceTolerance: 6,
    finalBalanceMax: 2.5,
  },
  {
    id: 19,
    name: 'SEALED AISLE',
    objective: 'Work around the sealed shelf',
    tip: 'The barred shelf is out of service. Everything fits without it.',
    shelves: [
      { slots: 6, maxWeight: 14 },
      { slots: 6, maxWeight: 10, locked: true },
      { slots: 6, maxWeight: 10, zone: { from: 4, to: 6 } },
    ],
    packages: ['priority', 'heavy', 'standard', 'heavy', 'standard'],
    balanceTolerance: 5,
  },

  // --- 20-23: everything at once --------------------------------------------
  {
    id: 20,
    name: 'MIXED FREIGHT',
    objective: 'Seven mixed packages, nothing broken',
    tip: 'Long, heavy and fragile in the same rack. Read the whole board first.',
    shelves: [
      { slots: 7, maxWeight: 11 },
      { slots: 6, maxWeight: 12 },
      { slots: 6, maxWeight: 8 },
    ],
    packages: ['long', 'heavy', 'fragile', 'heavy', 'fragile', 'standard', 'standard'],
    balanceTolerance: 5,
  },
  {
    id: 21,
    name: 'CROSS LOAD',
    objective: 'Four tiers, eight packages',
    tip: 'The top tier multiplies torque by 1.75. Keep it light and symmetric.',
    shelves: [
      { slots: 6, maxWeight: 10 },
      { slots: 6, maxWeight: 10 },
      { slots: 6, maxWeight: 8 },
      { slots: 6, maxWeight: 6 },
    ],
    packages: ['heavy', 'heavy', 'standard', 'fragile', 'standard', 'heavy', 'fragile', 'standard'],
    balanceTolerance: 4,
  },
  {
    id: 22,
    name: 'OVERTIME',
    objective: 'Priority cargo in a crowded rack',
    tip: 'The gold zone is on the heaviest shelf. Budget its capacity early.',
    shelves: [
      { slots: 7, maxWeight: 13, zone: { from: 0, to: 2 } },
      { slots: 7, maxWeight: 11 },
      { slots: 6, maxWeight: 8 },
    ],
    packages: ['priority', 'long', 'heavy', 'fragile', 'standard', 'heavy', 'standard'],
    balanceTolerance: 5,
  },
  {
    id: 23,
    name: 'NIGHT SHIFT',
    objective: 'One aisle sealed, one long package',
    tip: 'Losing a tier means the long package has only one home.',
    shelves: [
      { slots: 7, maxWeight: 12 },
      { slots: 6, maxWeight: 10, locked: true },
      { slots: 7, maxWeight: 10 },
      { slots: 5, maxWeight: 6 },
    ],
    packages: ['long', 'heavy', 'fragile', 'heavy', 'standard', 'standard', 'fragile'],
    balanceTolerance: 4,
  },

  // --- 24-25: the hard ones -------------------------------------------------
  {
    id: 24,
    name: 'FINAL INSPECTION',
    objective: 'Nine packages, imbalance under 2',
    tip: 'Every slot counts. There is almost no slack left in this rack.',
    shelves: [
      { slots: 7, maxWeight: 13 },
      { slots: 7, maxWeight: 11 },
      { slots: 6, maxWeight: 8 },
      { slots: 5, maxWeight: 6 },
    ],
    packages: [
      'long',
      'heavy',
      'fragile',
      'heavy',
      'standard',
      'fragile',
      'standard',
      'heavy',
      'standard',
    ],
    balanceTolerance: 5,
    finalBalanceMax: 2,
  },
  {
    id: 25,
    name: 'CARGO PANIC',
    objective: 'Ship the whole manifest',
    tip: 'Long, heavy, fragile, priority, a sealed aisle and a 3.0 red line.',
    shelves: [
      { slots: 7, maxWeight: 14, zone: { from: 5, to: 7 } },
      { slots: 7, maxWeight: 11 },
      { slots: 6, maxWeight: 9, locked: true },
      { slots: 6, maxWeight: 8 },
    ],
    packages: [
      'long',
      'priority',
      'heavy',
      'fragile',
      'heavy',
      'standard',
      'fragile',
      'standard',
      'standard',
    ],
    balanceTolerance: 3,
  },
];

export const TOTAL_LEVELS = LEVELS.length;

export function getLevel(id: number): LevelDef {
  const lv = LEVELS.find((l) => l.id === id);
  if (!lv) throw new Error(`Unknown level ${id}`);
  return lv;
}
