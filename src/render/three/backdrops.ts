/**
 * Decorative 3D scenes behind the menu screens. Each returns a Backdrop that
 * removes and frees exactly what it added.
 */

import type { LevelDef, PackageType } from '../../game/levels/types';
import type { Backdrop } from '../Stage';
import { Easing } from '../Tween';
import type { ThreeStage } from './ThreeStage';
import { Warehouse } from './Warehouse';
import { Cargo3D } from './world/Cargo3D';
import { Rack3D } from './world/Rack3D';

const HERO: LevelDef = {
  id: 0,
  name: 'HERO',
  objective: '',
  shelves: [
    { slots: 6, maxWeight: 99 },
    { slots: 6, maxWeight: 99 },
  ],
  packages: [],
  balanceTolerance: 99,
};

const HERO_CARGO: [PackageType, number, number][] = [
  ['heavy', 1, 0],
  ['standard', 1, 1],
  ['fragile', 1, 3],
  ['standard', 1, 4],
  ['long', 0, 0],
  ['priority', 0, 4],
];

/** Title screen: a lit hero rack swaying gently in the warehouse. */
export function menuBackdrop(stage: ThreeStage): Backdrop {
  // The hero rack sits a little lower so the wordmark has the top third.
  stage.frame(2, 6, (camera) => {
    camera.position.y += 0.4;
    camera.lookAt(0, 0.7, 0);
  });

  const rack = new Rack3D(stage.tweens, HERO, stage.scene);
  const warehouse = new Warehouse({ rackHalfWidth: rack.halfWidth });
  stage.scene.add(warehouse.group);

  const cargo: Cargo3D[] = [];
  for (const [type, tier, slot] of HERO_CARGO) {
    const c = new Cargo3D(stage.tweens, cargo.length, type);
    const s = rack.shelves[tier];
    c.mesh.position.set(s.slotCentreX(slot, c.slots), s.cargoCentreY, 0.02);
    rack.group.add(c.mesh);
    cargo.push(c);
  }
  const stopSway = stage.tweens.add(rack.group.rotation, { z: 0.02 }, {
    ms: 3200,
    yoyo: true,
    repeat: -1,
    ease: Easing.sineInOut,
  });
  rack.group.rotation.z = -0.02;
  const offTick = stage.onRender((dt) => warehouse.tick(dt));

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      stopSway();
      offTick();
      for (const c of cargo) c.dispose();
      rack.dispose();
      warehouse.dispose();
    },
  };
}

/** Level select: an empty warehouse, dimmed by the DOM overlay. */
export function levelsBackdrop(stage: ThreeStage): Backdrop {
  stage.frame(3, 7);
  const warehouse = new Warehouse({ rackHalfWidth: 3.8 });
  stage.scene.add(warehouse.group);
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      warehouse.dispose();
    },
  };
}
