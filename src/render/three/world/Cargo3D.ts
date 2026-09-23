/**
 * One piece of cargo as a mesh. Materials are cloned per instance so a single
 * box can pulse, crack or fade without touching its neighbours.
 *
 * `mesh` is the placement root the view moves, scales and re-parents; the box
 * itself is `body`, a child (picking hits the body). Keeping them apart lets
 * the tap-selection lift and rim ride on the body without fighting the
 * position tweens on the root.
 */

import * as THREE from 'three';
import { W3 } from '../../../game/config';
import { PACKAGE_SPECS } from '../../../game/levels/types';
import type { PackageSpec, PackageType } from '../../../game/levels/types';
import { cargoMaterials } from '../Materials';
import { Easing } from '../../Tween';
import type { Tweens } from '../../Tween';

export type CargoState = 'queued' | 'dragging' | 'placed' | 'falling';

/** Visual lift of a tap-selected package (world units, same as the 2D view). */
export const SELECT_LIFT = 0.12;

const RIM_SELECT = 0x8cc4ff;
const RIM_SPOT = 0xffc93c;

export class Cargo3D {
  readonly id: number;
  readonly type: PackageType;
  readonly spec: PackageSpec;
  /** Placement root: position, scale, rotation, parent and visibility. */
  readonly mesh: THREE.Group;
  /** The box (materials, shadows, picking). */
  readonly body: THREE.Mesh;
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
  private crackStill = false;
  /** Back-face shell a little larger than the box: the selection / spotlight outline. */
  private rim: THREE.Mesh;
  private rimMat: THREE.MeshBasicMaterial;
  private rimStop?: () => void;
  private rimKind: 'select' | 'spot' | null = null;

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
    this.body = new THREE.Mesh(geo, this.mats);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.userData.cargoId = id;

    // Drawn with no depth test just before the (transparent) box, which then
    // covers its middle: what shows is a full outline around the silhouette.
    this.rimMat = new THREE.MeshBasicMaterial({
      color: RIM_SELECT,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    const pad = 0.08;
    this.rim = new THREE.Mesh(new THREE.BoxGeometry(this.width + pad * 2, W3.cargoH + pad * 2, W3.cargoD + pad), this.rimMat);
    this.rim.visible = false;
    this.rim.renderOrder = -1;
    this.body.add(this.rim);

    this.mesh = new THREE.Group();
    this.mesh.add(this.body);
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

  /** Squash-and-stretch on touchdown. Heavier cargo squashes harder; `gentle` for reduced motion. */
  landBounce(strength = 1, gentle = false) {
    this.tweens.kill(this.mesh.scale);
    this.mesh.scale.set(1, 1, 1);
    const sq = Math.min(0.28, 0.1 + strength * 0.035) * (gentle ? 0.4 : 1);
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

  /** Fragile cargo under load: cracked face and (unless `still`) a nervous judder. Restyles if `still` changed. */
  setCracking(on: boolean, still = false) {
    if (!this.frontCracked) return;
    if (on === !!this.crackStop && (!on || still === this.crackStill)) return;
    if (on) {
      this.crackStop?.();
      this.crackStill = still;
      this.mats[4] = this.frontCracked;
      this.body.material = this.mats;
      const rot = this.body.rotation;
      const stop = still ? () => undefined : this.tweens.add(rot, { z: 0.03 }, { ms: 70, yoyo: true, repeat: -1 });
      this.crackStop = () => {
        stop();
        rot.z = 0;
      };
    } else {
      this.crackStop?.();
      this.crackStop = undefined;
      this.mats[4] = this.frontNormal;
      this.body.material = this.mats;
    }
  }

  /** Gold pulse used by the hint system (a steady glow when `still`). */
  setHinted(on: boolean, still = false) {
    this.hintStop?.();
    this.hintStop = undefined;
    for (const m of this.mats) m.emissiveIntensity = this.type === 'priority' ? 0.5 : 0;
    if (!on) return;
    const gold = new THREE.Color(0xffc93c);
    const saved = this.mats.map((m) => m.emissive.clone());
    for (const m of this.mats) m.emissive.copy(gold);
    const state = { v: 0.6 };
    const apply = () => {
      for (const m of this.mats) m.emissiveIntensity = 0.25 + state.v * 0.6;
    };
    apply();
    const stop = still
      ? () => undefined
      : this.tweens.add(state, { v: 1 }, { ms: 420, yoyo: true, repeat: -1, ease: Easing.sineInOut, onUpdate: apply });
    this.hintStop = () => {
      stop();
      this.mats.forEach((m, i) => {
        m.emissive.copy(saved[i]);
        m.emissiveIntensity = this.type === 'priority' ? 0.5 : 0;
      });
    };
  }

  /**
   * Tap-selection look, same as 2D: a blue rim pulses around the box (steady
   * under reduced motion) and, when `lift`, it rises a little.
   */
  setSelected(on: boolean, still = false, lift = true) {
    this.tweens.kill(this.body.position);
    this.tweens.add(this.body.position, { y: on && lift ? SELECT_LIFT : 0 }, { ms: 140, ease: Easing.quadOut });
    if (on) this.showRim('select', still);
    else if (this.rimKind === 'select') this.hideRim();
  }

  /** Gold spotlight rim: a loss reason or a tutorial pointing at this package. */
  setSpotlit(on: boolean, still = false) {
    if (on) this.showRim('spot', still);
    else if (this.rimKind === 'spot') this.hideRim();
  }

  private showRim(kind: 'select' | 'spot', still: boolean) {
    this.hideRim();
    this.rimKind = kind;
    this.rimMat.color.setHex(kind === 'select' ? RIM_SELECT : RIM_SPOT);
    this.rimMat.opacity = 0.95;
    this.rim.visible = this.opacity > 0.05;
    if (still) return;
    this.rimMat.opacity = 0.55;
    this.rimStop = this.tweens.add(this.rimMat, { opacity: 1 }, {
      ms: kind === 'select' ? 450 : 500,
      yoyo: true,
      repeat: -1,
      ease: Easing.sineInOut,
    });
  }

  private hideRim() {
    this.rimStop?.();
    this.rimStop = undefined;
    this.rimKind = null;
    this.rim.visible = false;
  }

  setOpacity(a: number) {
    for (const m of this.mats) m.opacity = a;
    if (this.frontCracked) this.frontCracked.opacity = a;
    // The rim reads as an outline only because the box covers its middle: once the box has faded
    // (a shattered crate) it would be a solid block, so it goes too; a highlight's marker still points there.
    this.rim.visible = this.rimKind !== null && a > 0.05;
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
    this.hideRim();
    this.tweens.kill(this.mesh.position);
    this.tweens.kill(this.mesh.scale);
    this.tweens.kill(this.mesh.rotation);
    this.tweens.kill(this.body.position);
    this.mesh.removeFromParent();
    this.body.geometry.dispose();
    this.rim.geometry.dispose();
    this.rimMat.dispose();
    // While cracked, mats[4] is frontCracked, so the normal front is not in the list.
    for (const m of new Set([...this.mats, this.frontNormal])) m.dispose();
    this.frontCracked?.dispose();
  }
}
