/**
 * One piece of cargo as a mesh. Materials are cloned per instance so a single
 * box can pulse, crack or fade without touching its neighbours.
 */

import * as THREE from 'three';
import { W3 } from '../../../game/config';
import { PACKAGE_SPECS } from '../../../game/levels/types';
import type { PackageSpec, PackageType } from '../../../game/levels/types';
import { cargoMaterials } from '../Materials';
import { Easing } from '../../Tween';
import type { Tweens } from '../../Tween';

export type CargoState = 'queued' | 'dragging' | 'placed' | 'falling';

export class Cargo3D {
  readonly id: number;
  readonly type: PackageType;
  readonly spec: PackageSpec;
  readonly mesh: THREE.Mesh;
  /** Width in world units. */
  readonly width: number;

  state: CargoState = 'queued';
  shelf = -1;
  slot = -1;

  private mats: THREE.MeshStandardMaterial[];
  private frontNormal: THREE.MeshStandardMaterial;
  private frontCracked?: THREE.MeshStandardMaterial;
  private hintStop?: () => void;
  private crackStop?: () => void;

  constructor(
    private tweens: Tweens,
    id: number,
    type: PackageType,
  ) {
    this.id = id;
    this.type = type;
    this.spec = PACKAGE_SPECS[type];
    this.width = this.spec.slots * W3.slot - W3.cargoGap;

    const src = cargoMaterials(type);
    this.mats = src.faces.map((m) => (m as THREE.MeshStandardMaterial).clone());
    this.frontNormal = this.mats[4];
    if (src.crackedFront) this.frontCracked = src.crackedFront.clone();
    for (const m of this.mats) m.transparent = true;

    const geo = new THREE.BoxGeometry(this.width, W3.cargoH, W3.cargoD);
    this.mesh = new THREE.Mesh(geo, this.mats);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.cargoId = id;
  }

  get weight() {
    return this.spec.weight;
  }

  get slots() {
    return this.spec.slots;
  }

  /** Lifted cargo grows a touch so it reads as "in hand". */
  setDragging(on: boolean) {
    this.tweens.kill(this.mesh.scale);
    const s = on ? 1.07 : 1;
    this.tweens.add(this.mesh.scale, { x: s, y: s, z: s }, { ms: 120, ease: Easing.backOut });
  }

  /** Squash-and-stretch on touchdown. Heavier cargo squashes harder. */
  landBounce(strength = 1) {
    this.tweens.kill(this.mesh.scale);
    this.mesh.scale.set(1, 1, 1);
    const sq = Math.min(0.28, 0.1 + strength * 0.035);
    this.tweens.add(this.mesh.scale, { x: 1 + sq, y: 1 - sq }, {
      ms: 80,
      ease: Easing.quadOut,
      onDone: () =>
        this.tweens.add(this.mesh.scale, { x: 1 - sq * 0.4, y: 1 + sq * 0.4 }, {
          ms: 90,
          ease: Easing.quadInOut,
          onDone: () => this.tweens.add(this.mesh.scale, { x: 1, y: 1 }, { ms: 130, ease: Easing.backOut }),
        }),
    });
  }

  /** Fragile cargo under load: cracked face and a nervous judder. */
  setCracking(on: boolean) {
    if (!this.frontCracked) return;
    if (on === !!this.crackStop) return;
    if (on) {
      this.mats[4] = this.frontCracked;
      this.mesh.material = this.mats;
      const rot = this.mesh.rotation;
      const stop = this.tweens.add(rot, { z: 0.03 }, { ms: 70, yoyo: true, repeat: -1 });
      this.crackStop = () => {
        stop();
        rot.z = 0;
      };
    } else {
      this.crackStop?.();
      this.crackStop = undefined;
      this.mats[4] = this.frontNormal;
      this.mesh.material = this.mats;
    }
  }

  /** Gold pulse used by the hint system. */
  setHinted(on: boolean) {
    this.hintStop?.();
    this.hintStop = undefined;
    for (const m of this.mats) m.emissiveIntensity = this.type === 'priority' ? 0.5 : 0;
    if (!on) return;
    const gold = new THREE.Color(0xffc93c);
    const saved = this.mats.map((m) => m.emissive.clone());
    for (const m of this.mats) m.emissive.copy(gold);
    const state = { v: 0 };
    const stop = this.tweens.add(state, { v: 1 }, {
      ms: 420,
      yoyo: true,
      repeat: -1,
      ease: Easing.sineInOut,
      onUpdate: () => {
        for (const m of this.mats) m.emissiveIntensity = 0.25 + state.v * 0.6;
      },
    });
    this.hintStop = () => {
      stop();
      this.mats.forEach((m, i) => {
        m.emissive.copy(saved[i]);
        m.emissiveIntensity = this.type === 'priority' ? 0.5 : 0;
      });
    };
  }

  setOpacity(a: number) {
    for (const m of this.mats) m.opacity = a;
    if (this.frontCracked) this.frontCracked.opacity = a;
  }

  get opacity() {
    return this.mats[0].opacity;
  }

  worldPosition(out = new THREE.Vector3()) {
    return this.mesh.getWorldPosition(out);
  }

  dispose() {
    this.hintStop?.();
    this.crackStop?.();
    this.tweens.kill(this.mesh.position);
    this.tweens.kill(this.mesh.scale);
    this.tweens.kill(this.mesh.rotation);
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    // While cracked, mats[4] is frontCracked, so the normal front is not in the list.
    for (const m of new Set([...this.mats, this.frontNormal])) m.dispose();
    this.frontCracked?.dispose();
  }
}
