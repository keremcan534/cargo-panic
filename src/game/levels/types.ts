/**
 * Pure data model for levels and packages. Deliberately free of any renderer
 * import so the same types drive the headless level validator in scripts/.
 */

export type PackageType = 'standard' | 'heavy' | 'fragile' | 'long' | 'priority';

export interface PackageSpec {
  type: PackageType;
  /** Contribution to torque and to shelf load. */
  weight: number;
  /** Horizontal slots consumed. */
  slots: number;
  label: string;
  /** Short blurb shown in the package inspector. */
  blurb: string;
}

export const PACKAGE_SPECS: Record<PackageType, PackageSpec> = {
  standard: {
    type: 'standard',
    weight: 2,
    slots: 1,
    label: 'BOX',
    blurb: 'Standard carton. Weight 2.',
  },
  heavy: {
    type: 'heavy',
    weight: 5,
    slots: 1,
    label: 'HEAVY',
    blurb: 'Heavy crate. Weight 5. Crushes fragile cargo below it.',
  },
  fragile: {
    type: 'fragile',
    weight: 1,
    slots: 1,
    label: 'FRAGILE',
    blurb: 'Weight 1. Nothing heavy may sit in the column above it.',
  },
  long: {
    type: 'long',
    weight: 3,
    slots: 3,
    label: 'LONG',
    blurb: 'Weight 3. Takes up three slots.',
  },
  priority: {
    type: 'priority',
    weight: 2,
    slots: 1,
    label: 'PRIORITY',
    blurb: 'Weight 2. Must end up inside the gold zone.',
  },
};

export interface ZoneDef {
  /** Inclusive first slot of the gold destination zone. */
  from: number;
  /** Exclusive last slot. */
  to: number;
}

export interface ShelfDef {
  /** Number of placement slots across. */
  slots: number;
  /** Combined package weight this shelf can hold before it starts to buckle. */
  maxWeight: number;
  /** Barred off - nothing can be placed here. */
  locked?: boolean;
  /** Gold destination zone for priority cargo. */
  zone?: ZoneDef;
}

export interface LevelDef {
  id: number;
  name: string;
  /** One-line win condition shown in the HUD. */
  objective: string;
  /** Optional coaching line shown on level start. */
  tip?: string;
  /** Index 0 is the BOTTOM shelf. Higher index = higher tier = more leverage. */
  shelves: ShelfDef[];
  /** Arrival order on the conveyor. */
  packages: PackageType[];
  /** Imbalance above this puts the rack in the red. */
  balanceTolerance: number;
  /** Stricter imbalance required at the moment the level completes. */
  finalBalanceMax?: number;
}

/** Leverage multiplier applied to every package on the given tier. */
export function tierLeverage(tier: number, step: number): number {
  return 1 + tier * step;
}
