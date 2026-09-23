/**
 * Decorative 3D scenes behind the menu screens. Each returns a Backdrop that
 * removes and frees exactly what it added.
 */

import { HERO_CARGO, HERO_LEVEL, heroSway } from '../hero';
import type { Backdrop } from '../Stage';
import type { ThreeStage } from './ThreeStage';
import { Warehouse } from './Warehouse';
import { Cargo3D } from './world/Cargo3D';
import { Rack3D } from './world/Rack3D';

/** Title screen: a lit hero rack swaying gently in the warehouse. */
export function menuBackdrop(stage: ThreeStage): Backdrop {
  // The hero rack sits a little lower so the wordmark has the top third.
  stage.frame(2, 6, (camera) => {
    camera.position.y += 0.4;
    camera.lookAt(0, 0.7, 0);
  });

  const rack = new Rack3D(stage.tweens, HERO_LEVEL, stage.scene);
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
  // Same sway as the 2D title (hero.ts); none under reduced motion (read
  // every frame, so the setting applies at once).
  let t = 0;
  const sway = (dt: number) => {
    t += dt;
    rack.group.rotation.z = stage.reducedMotion ? 0 : heroSway(t);
  };
  sway(0);
  const offTick = stage.onRender((dt) => {
    warehouse.tick(dt);
    sway(dt);
  });

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
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
