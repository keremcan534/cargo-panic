/**
 * One shelf tier inside the rack group: plank, end caps, the instrument label
 * under the lip (leverage and live load), and the gold-zone / sealed decor.
 */

import * as THREE from 'three';
import { TIER_LEVERAGE_STEP, W3 } from '../../../game/config';
import { tierLeverage } from '../../../game/levels/types';
import type { ShelfDef } from '../../../game/levels/types';
import { MAT, drawShelfLabel, priorityTagTexture, sealedTexture } from '../Materials';
import { t } from '../../../i18n';
import { cargoCentreY, shelfSurfaceY, slotCentreX, slotFromX } from '../../layout';
import { Easing } from '../../Tween';
import type { Tweens } from '../../Tween';

export class Shelf3D {
  readonly tier: number;
  readonly def: ShelfDef;
  readonly width: number;
  readonly surfaceY: number;
  readonly leverage: number;
  readonly group = new THREE.Group();

  private plank: THREE.Group;
  private labelCanvas: HTMLCanvasElement;
  private labelTex: THREE.CanvasTexture;
  private glow: THREE.Mesh;
  private glowMat: THREE.MeshBasicMaterial;
  private glowStop?: () => void;
  private load = 0;

  constructor(
    private tweens: Tweens,
    parent: THREE.Group,
    tier: number,
    def: ShelfDef,
    rackHalfW: number,
  ) {
    this.tier = tier;
    this.def = def;
    this.width = def.slots * W3.slot;
    this.surfaceY = shelfSurfaceY(tier);
    this.leverage = tierLeverage(tier, TIER_LEVERAGE_STEP);

    const y = this.surfaceY;
    const half = this.width / 2;

    this.plank = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(this.width, W3.plankH, W3.plankD), MAT.steel);
    slab.position.set(0, y - W3.plankH / 2, 0);
    slab.castShadow = true;
    slab.receiveShadow = true;
    this.plank.add(slab);

    const lip = new THREE.Mesh(new THREE.BoxGeometry(this.width, 0.05, 0.06), MAT.steelLit);
    lip.position.set(0, y - 0.02, W3.plankD / 2 - 0.02);
    this.plank.add(lip);

    // Brackets tying the plank back into the uprights.
    for (const sx of [-1, 1]) {
      const span = rackHalfW - half;
      if (span > 0.05) {
        const br = new THREE.Mesh(new THREE.BoxGeometry(span, W3.plankH * 0.7, 0.5), MAT.steelDark);
        br.position.set(sx * (half + span / 2), y - W3.plankH / 2, -0.2);
        this.plank.add(br);
      }
    }
    this.group.add(this.plank);

    // Instrument label under the lip.
    this.labelCanvas = drawShelfLabel(null, this.width, {
      leverage: this.leverage,
      tier,
      load: 0,
      max: def.maxWeight,
    });
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTex.colorSpace = THREE.SRGBColorSpace;
    // The label canvas is drawn at (width x 0.3) units, so the plane matches.
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width, 0.3),
      new THREE.MeshBasicMaterial({ map: this.labelTex, transparent: true, depthWrite: false }),
    );
    label.position.set(0, y - W3.plankH - 0.17, W3.plankD / 2 + 0.01);
    label.renderOrder = 5;
    this.group.add(label);

    // Red glow behind the plank while overloaded.
    this.glowMat = MAT.overloadGlow.clone();
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(this.width + 0.5, 0.7), this.glowMat);
    this.glow.position.set(0, y - 0.05, -W3.plankD / 2 - 0.05);
    this.glow.renderOrder = 4;
    this.group.add(this.glow);

    if (def.locked) this.buildSealed();
    else if (def.zone) this.buildZone();

    parent.add(this.group);
  }

  // --- geometry (the shared hit-test in render/layout.ts) ---------------------

  slotCentreX(slot: number, slots: number): number {
    return slotCentreX(this.def.slots, slot, slots);
  }

  slotFromX(localX: number, slots: number): number {
    return slotFromX(this.def.slots, localX, slots);
  }

  /** Centre y of cargo resting on this shelf. */
  get cargoCentreY(): number {
    return cargoCentreY(this.tier);
  }

  // --- decor ----------------------------------------------------------------

  private buildSealed() {
    const y = this.surfaceY;
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(this.width, W3.cargoH, W3.cargoD * 0.98),
      MAT.locked,
    );
    block.position.set(0, y + W3.cargoH / 2, 0);
    block.renderOrder = 3;
    this.group.add(block);

    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width, W3.cargoH),
      new THREE.MeshBasicMaterial({ map: sealedTexture(this.width, t('shelf.sealed')), transparent: true }),
    );
    plaque.position.set(0, y + W3.cargoH / 2, W3.cargoD / 2 + 0.005);
    plaque.renderOrder = 4;
    this.group.add(plaque);
  }

  private buildZone() {
    const z = this.def.zone;
    if (!z) return;
    const y = this.surfaceY;
    const x0 = (z.from - this.def.slots / 2) * W3.slot;
    const w = (z.to - z.from) * W3.slot;
    const cx = x0 + w / 2;

    const slab = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, W3.cargoH, W3.cargoD * 0.96), MAT.zone);
    slab.position.set(cx, y + W3.cargoH / 2, 0);
    slab.renderOrder = 2;
    this.group.add(slab);

    // Rim on the plank surface.
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, 0.04, W3.cargoD * 0.96), MAT.zoneRim);
    rim.position.set(cx, y + 0.02, 0);
    this.group.add(rim);

    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.26),
      new THREE.MeshBasicMaterial({ map: priorityTagTexture(t('shelf.priorityTag')), transparent: true, depthWrite: false }),
    );
    tag.position.set(cx, y + 0.2, W3.cargoD * 0.48 + 0.02);
    tag.renderOrder = 6;
    this.group.add(tag);
  }

  // --- state ----------------------------------------------------------------

  setLoad(weight: number) {
    if (weight === this.load) return;
    this.load = weight;
    drawShelfLabel(this.labelCanvas, this.width, {
      leverage: this.leverage,
      tier: this.tier,
      load: weight,
      max: this.def.maxWeight,
    });
    this.labelTex.needsUpdate = true;
  }

  setOverloaded(on: boolean) {
    if (on === !!this.glowStop) return;
    if (on) {
      const stop = this.tweens.add(this.glowMat, { opacity: 0.55 }, {
        ms: 300,
        yoyo: true,
        repeat: -1,
        ease: Easing.sineInOut,
      });
      this.glowStop = () => {
        stop();
        this.glowMat.opacity = 0;
      };
    } else {
      this.glowStop?.();
      this.glowStop = undefined;
    }
  }

  /** Plank dips under a landing package and springs back. */
  flex(strength: number) {
    this.tweens.kill(this.plank.position);
    this.plank.position.y = 0;
    this.tweens.add(this.plank.position, { y: -Math.min(0.06, 0.012 * strength) }, {
      ms: 80,
      yoyo: true,
      ease: Easing.quadOut,
      onDone: () => {
        this.plank.position.y = 0;
      },
    });
  }

  /** Stops its tweens and frees the label texture; the rack frees the meshes. */
  dispose() {
    this.glowStop?.();
    this.tweens.kill(this.plank.position);
    this.labelTex.dispose();
  }
}
