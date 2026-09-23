/**
 * Decorative 3D scenes behind the menu screens. Each returns a Backdrop that
 * removes and frees exactly what it added.
 */

import * as THREE from 'three';
import { HERO_BOX_3D, HERO_CARGO, HERO_DEPTH_3D, HERO_LEVEL, heroSway } from '../hero';
import type { HeroBox } from '../hero';
import type { Backdrop, ScreenRect } from '../Stage';
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
  // Where the rack is drawn now, for tests: its box at the current sway, through the camera.
  const offProbe = stage.reportHero(() => {
    if (disposed || !rack.group.visible) return null;
    rack.group.updateMatrixWorld();
    return projectBox(stage, HERO_BOX_3D, rack.group.matrixWorld);
  });

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      offTick();
      offProbe();
      for (const c of cargo) c.dispose();
      rack.dispose();
      warehouse.dispose();
    },
  };
}

const corner = new THREE.Vector3();

/**
 * Screen rect (CSS px) of a hero-rack box - `box` in x and y, +-HERO_DEPTH_3D
 * in z - placed by `matrix` (or as it stands), seen through the stage camera.
 */
function projectBox(stage: ThreeStage, box: HeroBox, matrix?: THREE.Matrix4): ScreenRect {
  const { width, height } = stage.viewSize;
  const camera = stage.camera;
  camera.updateMatrixWorld();
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const x of [box.x0, box.x1]) {
    for (const y of [box.y0, box.y1]) {
      for (const z of [-HERO_DEPTH_3D, HERO_DEPTH_3D]) {
        corner.set(x, y, z);
        if (matrix) corner.applyMatrix4(matrix);
        corner.project(camera);
        const sx = ((corner.x + 1) / 2) * width;
        const sy = ((1 - corner.y) / 2) * height;
        x0 = Math.min(x0, sx);
        x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy);
        y1 = Math.max(y1, sy);
      }
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
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
