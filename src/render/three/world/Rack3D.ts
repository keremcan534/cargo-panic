/**
 * The storage rack: frame, shelves, the tilt that visualises imbalance, and
 * the overlays (drop ghost, fragile no-crush columns). One group pivoted at
 * floor level, so rolling it leans the whole structure - cargo included.
 */

import * as THREE from 'three';
import { MAX_TILT_DEG, W3 } from '../../../game/config';
import type { LevelDef, PackageType } from '../../../game/levels/types';
import { drawIcon } from '../../art/icons';
import type { IconKind } from '../../art/icons';
import { MAT } from '../Materials';
import { disposeTree } from '../dispose';
import { nearestShelf, rackHalfWidth, rackTopY } from '../../layout';
import { Easing } from '../../Tween';
import type { Tweens } from '../../Tween';
import type { Cargo3D } from './Cargo3D';
import { Shelf3D } from './Shelf3D';

export type GhostKind = 'ok' | 'crush' | 'bad' | 'hint';

/** Per ghost kind: its material and the icon decal that says the same without colour (as in 2D). */
const GHOST_LOOK: Record<GhostKind, { mat: THREE.Material; icon: IconKind; color: string }> = {
  ok: { mat: MAT.ghostOk, icon: 'ok', color: '#3fd68a' },
  crush: { mat: MAT.ghostWarn, icon: 'crush', color: '#f5c451' },
  bad: { mat: MAT.ghostBad, icon: 'bad', color: '#ff5f57' },
  hint: { mat: MAT.ghostHint, icon: 'hint', color: '#ffc93c' },
};

/** Icon decal size in world units. */
const ICON_SIZE = 0.44;

function iconTexture(kind: GhostKind): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const look = GHOST_LOOK[kind];
  drawIcon(ctx, look.icon, 64, 64, 56, look.color);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** What the crush-column overlay needs to know about a stowed package. */
export interface StowedCargo {
  type: PackageType;
  shelf: number;
  slot: number;
  slots: number;
}

export class Rack3D {
  readonly group = new THREE.Group();
  readonly shelves: Shelf3D[] = [];
  readonly halfWidth: number;
  readonly topY: number;

  private ghost: THREE.Mesh;
  /** The ghost's kind icon, drawn over everything (it rides the top edge, clear of a package in hand). */
  private ghostIcon: THREE.Mesh;
  private ghostIconMat: THREE.MeshBasicMaterial;
  private iconTex = new Map<GhostKind, THREE.CanvasTexture>();
  /** Faint outline of a held package's committed slot. */
  private home = new THREE.Group();
  private columns = new THREE.Group();
  /** One material for every crush band; only its opacity changes. */
  private columnMat = MAT.crushBand.clone();
  private targetRoll = 0;
  private wobble = 0;
  private wobblePhase = 0;
  private collapsing = false;

  constructor(
    private tweens: Tweens,
    private level: LevelDef,
    parent: THREE.Object3D,
  ) {
    const maxSlots = Math.max(...level.shelves.map((s) => s.slots));
    this.halfWidth = rackHalfWidth(maxSlots);
    this.topY = rackTopY(level.shelves.length);
    const hw = this.halfWidth;

    // Uprights and feet.
    for (const sx of [-1, 1]) {
      const up = new THREE.Mesh(new THREE.BoxGeometry(0.22, this.topY, 1.3), MAT.steel);
      up.position.set(sx * hw, this.topY / 2, 0);
      up.castShadow = true;
      up.receiveShadow = true;
      this.group.add(up);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 1.5), MAT.steel);
      foot.position.set(sx * hw, 0.04, 0);
      this.group.add(foot);
      // Bolt holes down the front of each upright.
      for (let y = 0.6; y < this.topY - 0.4; y += 0.7) {
        const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.02), MAT.steelDark);
        bolt.position.set(sx * hw, y, 0.66);
        this.group.add(bolt);
      }
    }

    // Cap beam with a hazard stripe.
    const cap = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.22, 0.16, 1.3), MAT.steel);
    cap.position.set(0, this.topY - 0.08, 0);
    cap.castShadow = true;
    this.group.add(cap);
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xf0a53c,
      emissive: 0x3a2200,
      roughness: 0.6,
    });
    for (let x = -hw + 0.3; x < hw - 0.2; x += 0.5) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.02), stripeMat);
      s.position.set(x, this.topY - 0.08, 0.66);
      this.group.add(s);
    }

    for (let t = 0; t < level.shelves.length; t++) {
      this.shelves.push(new Shelf3D(tweens, this.group, t, level.shelves[t], hw));
    }

    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, W3.cargoH, W3.cargoD), MAT.ghostOk);
    this.ghost.visible = false;
    this.ghost.renderOrder = 7;
    this.ghostIconMat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
    this.ghostIcon = new THREE.Mesh(new THREE.PlaneGeometry(ICON_SIZE, ICON_SIZE), this.ghostIconMat);
    this.ghostIcon.visible = false;
    this.ghostIcon.renderOrder = 60;

    const homeBox = new THREE.BoxGeometry(1, W3.cargoH, W3.cargoD);
    const homeFill = new THREE.Mesh(homeBox, MAT.homeFill);
    const homeEdge = new THREE.LineSegments(new THREE.EdgesGeometry(homeBox), MAT.homeEdge);
    homeFill.renderOrder = 6;
    homeEdge.renderOrder = 6;
    this.home.add(homeFill, homeEdge);
    this.home.visible = false;
    this.group.add(this.ghost, this.ghostIcon, this.home, this.columns);

    parent.add(this.group);
  }

  // --- transforms -----------------------------------------------------------

  toLocal(world: THREE.Vector3, out = new THREE.Vector3()) {
    return this.group.worldToLocal(out.copy(world));
  }

  toWorld(local: THREE.Vector3, out = new THREE.Vector3()) {
    return this.group.localToWorld(out.copy(local));
  }

  /** Nearest tier to a rack-local point, or -1 when far outside the rack (shared hit-test). */
  nearestShelf(localX: number, localY: number): number {
    return nearestShelf(this.level, localX, localY);
  }

  /** Re-parents cargo into the rack keeping its world transform. */
  attach(cargo: Cargo3D) {
    this.group.attach(cargo.mesh);
  }

  detach(cargo: Cargo3D, scene: THREE.Object3D) {
    scene.attach(cargo.mesh);
  }

  // --- overlays -------------------------------------------------------------

  /** Outline of every cell a package `slots` wide would occupy, plus the kind's icon. */
  showGhost(tier: number, slot: number, slots: number, kind: GhostKind) {
    const s = this.shelves[tier];
    if (!s) return this.hideGhost();
    const look = GHOST_LOOK[kind];
    this.ghost.material = look.mat;
    const w = slots * W3.slot - W3.cargoGap;
    const x = s.slotCentreX(slot, slots);
    this.ghost.scale.set(w, 1, 1);
    this.ghost.position.set(x, s.cargoCentreY, 0.02);
    this.ghost.visible = true;
    let tex = this.iconTex.get(kind);
    if (!tex) {
      tex = iconTexture(kind);
      this.iconTex.set(kind, tex);
    }
    if (this.ghostIconMat.map !== tex) {
      this.ghostIconMat.map = tex;
      this.ghostIconMat.needsUpdate = true;
    }
    this.ghostIcon.position.set(x, s.cargoCentreY + W3.cargoH / 2, W3.dragZ + 0.1);
    this.ghostIcon.visible = true;
  }

  hideGhost() {
    this.ghost.visible = false;
    this.ghostIcon.visible = false;
  }

  /** Marks the slot a held package still occupies in the rules. */
  showHome(tier: number, slot: number, slots: number) {
    const s = this.shelves[tier];
    if (!s) return this.hideHome();
    this.home.scale.set(slots * W3.slot - W3.cargoGap, 1, 1);
    this.home.position.set(s.slotCentreX(slot, slots), s.cargoCentreY, 0.02);
    this.home.visible = true;
  }

  hideHome() {
    this.home.visible = false;
  }

  /** Vertical "no heavy cargo" bands above every stowed fragile crate. */
  updateCrushColumns(placed: readonly StowedCargo[], emphasise: boolean) {
    for (const c of [...this.columns.children]) {
      this.columns.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    const mat = this.columnMat;
    mat.opacity = emphasise ? 0.3 : 0.11;
    for (const p of placed) {
      if (p.type !== 'fragile' || p.shelf < 0) continue;
      if (p.shelf >= this.shelves.length - 1) continue;
      const s = this.shelves[p.shelf];
      const bottom = s.surfaceY + W3.cargoH;
      const top = this.topY - 0.2;
      const h = Math.max(0.1, top - bottom);
      const w = p.slots * W3.slot - 0.14;
      const band = new THREE.Mesh(new THREE.BoxGeometry(w, h, W3.cargoD * 0.9), mat);
      band.position.set(s.slotCentreX(p.slot, p.slots), bottom + h / 2, 0);
      band.renderOrder = 3;
      this.columns.add(band);
    }
  }

  // --- tilt -----------------------------------------------------------------

  setBalance(net: number, tolerance: number, danger: boolean) {
    if (this.collapsing) return;
    const ratio = Math.max(-1, Math.min(1, net / (tolerance * 2)));
    // Positive net leans right; a positive roll about z leans the top left.
    this.targetRoll = -ratio * MAX_TILT_DEG * (Math.PI / 180);
    this.wobble = danger ? 1 : 0;
  }

  /** Eases the lean; `still` (reduced motion) drops the danger wobble. */
  tick(dtMs: number, still = false) {
    if (this.collapsing) return;
    const k = 1 - Math.pow(0.0015, dtMs / 1000);
    let target = this.targetRoll;
    if (this.wobble > 0 && !still) {
      this.wobblePhase += dtMs / 1000;
      target += Math.sin(this.wobblePhase * 11) * 0.55 * (Math.PI / 180);
    }
    this.group.rotation.z += (target - this.group.rotation.z) * k;
  }

  celebrate() {
    this.tweens.add(this.group.scale, { x: 1.03, y: 1.03 }, {
      ms: 170,
      yoyo: true,
      onDone: () => this.group.scale.set(1, 1, 1),
    });
  }

  /** Snaps the rack over hard; cargo detachment is the caller's job. */
  collapse(direction: number, onDone: () => void) {
    this.collapsing = true;
    const rot = this.group.rotation;
    this.tweens.add(rot, { z: -direction * 26 * (Math.PI / 180) }, {
      ms: 420,
      ease: Easing.backIn,
      onDone: () =>
        this.tweens.add(rot, { z: -direction * 21 * (Math.PI / 180) }, {
          ms: 220,
          ease: Easing.bounceOut,
          onDone,
        }),
    });
  }

  /**
   * Frees the frame, shelves, overlays and their materials. Cargo parented to
   * the rack belongs to its owner, which must dispose it first.
   */
  dispose() {
    this.tweens.kill(this.group.scale);
    this.tweens.kill(this.group.rotation);
    for (const s of this.shelves) s.dispose();
    disposeTree(this.group);
    // Not reachable through the tree when no crush band is showing.
    this.columnMat.dispose();
    for (const t of this.iconTex.values()) t.dispose();
    this.iconTex.clear();
  }

  /** Ends the danger wobble (the shipment is over). */
  stopWobble() {
    this.wobble = 0;
  }
}
