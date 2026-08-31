/**
 * The storage rack: frame, shelves, and the tilt that visualises imbalance.
 *
 * The whole thing is one container pivoted at floor level, so rotating it leans
 * the entire structure - cargo included - exactly like a real rack going over.
 */

import Phaser from 'phaser';
import { COLORS, MAX_TILT_DEG, PKG_H, SHELF_SPACING, SLOT_W } from '../config';
import type { LevelDef } from '../levels/types';
import { Shelf } from './Shelf';
import type { CargoPackage } from './Package';

export class Rack {
  readonly container: Phaser.GameObjects.Container;
  readonly shelves: Shelf[] = [];
  readonly halfWidth: number;
  readonly topY: number;
  readonly scale: number;

  private frame: Phaser.GameObjects.Graphics;
  private columns: Phaser.GameObjects.Graphics;
  private ghost: Phaser.GameObjects.Graphics;
  private targetRotation = 0;
  private wobble = 0;
  private wobblePhase = 0;

  constructor(
    private scene: Phaser.Scene,
    level: LevelDef,
    x: number,
    baseY: number,
    scale = 1,
  ) {
    const maxSlots = Math.max(...level.shelves.map((s) => s.slots));
    this.halfWidth = (maxSlots * SLOT_W) / 2 + 22;
    this.topY = -((level.shelves.length - 1) * SHELF_SPACING) - PKG_H - 26;
    this.scale = scale;

    this.container = scene.add.container(x, baseY);
    this.container.setScale(scale);
    this.frame = scene.add.graphics();
    this.container.add(this.frame);
    this.drawFrame();

    for (let t = 0; t < level.shelves.length; t++) {
      this.shelves.push(new Shelf(scene, this.container, t, level.shelves[t], this.halfWidth));
    }

    this.columns = scene.add.graphics();
    this.ghost = scene.add.graphics();
    this.container.add([this.columns, this.ghost]);
  }

  // --- structure ------------------------------------------------------------

  private drawFrame() {
    const g = this.frame;
    const hw = this.halfWidth;
    const top = this.topY;
    const beam = 24;

    // Back panel wash so the rack reads as a solid object against the floor.
    g.fillStyle(0x0b1017, 0.5);
    g.fillRect(-hw - 4, top, (hw + 4) * 2, -top + 44);

    for (const sx of [-1, 1]) {
      const x = sx * hw - beam / 2;
      g.fillStyle(COLORS.frameDark, 1);
      g.fillRect(x, top, beam, -top + 44);
      g.fillStyle(COLORS.frameLight, 1);
      g.fillRect(x, top, 7, -top + 44);
      g.fillStyle(0x000000, 0.35);
      g.fillRect(x + beam - 5, top, 5, -top + 44);

      // Bolt holes down the upright.
      g.fillStyle(0x0d1219, 0.85);
      for (let y = top + 18; y < 34; y += 34) g.fillRect(x + 10, y, 6, 8);

      // Foot plate.
      g.fillStyle(COLORS.frameLight, 1);
      g.fillRoundedRect(x - 11, 44, beam + 22, 15, 3);
      g.fillStyle(COLORS.frameDark, 1);
      g.fillRect(x - 11, 54, beam + 22, 5);
    }

    // Top cap beam.
    g.fillStyle(COLORS.frameDark, 1);
    g.fillRect(-hw - beam / 2, top, hw * 2 + beam, 15);
    g.fillStyle(COLORS.frameEdge, 1);
    g.fillRect(-hw - beam / 2, top, hw * 2 + beam, 5);

    // Safety stripe along the cap.
    g.fillStyle(COLORS.accentWarm, 0.5);
    for (let x = -hw; x < hw; x += 34) g.fillRect(x, top + 6, 16, 4);
  }

  /** Cargo is added to the container as it lands, so re-float the overlays. */
  raiseOverlays() {
    this.container.bringToTop(this.columns);
    this.container.bringToTop(this.ghost);
  }

  // --- placement helpers ----------------------------------------------------

  /** Converts a scene-space point into rack-local coordinates. */
  toLocal(sceneX: number, sceneY: number): Phaser.Math.Vector2 {
    const m = this.container.getWorldTransformMatrix();
    const out = new Phaser.Math.Vector2();
    m.applyInverse(sceneX, sceneY, out);
    return out;
  }

  /** Scene-space position of a package resting at (shelf, slot). */
  toScene(localX: number, localY: number): Phaser.Math.Vector2 {
    const m = this.container.getWorldTransformMatrix();
    const out = new Phaser.Math.Vector2();
    m.transformPoint(localX, localY, out);
    return out;
  }

  /** Nearest shelf tier to a rack-local y, or -1 when far outside the rack. */
  nearestShelf(localX: number, localY: number): number {
    let best = -1;
    let bestDist = Infinity;
    for (const shelf of this.shelves) {
      if (Math.abs(localX) > shelf.width / 2 + SLOT_W * 0.75) continue;
      // Measure to the middle of the shelf's cargo band.
      const d = Math.abs(localY - (shelf.surfaceY - PKG_H / 2));
      if (d < bestDist) {
        bestDist = d;
        best = shelf.tier;
      }
    }
    return bestDist <= SHELF_SPACING * 0.72 ? best : -1;
  }

  // --- feedback overlays ----------------------------------------------------

  showGhost(tier: number, slot: number, slots: number, kind: 'ok' | 'bad' | 'crush') {
    const shelf = this.shelves[tier];
    if (!shelf) return this.hideGhost();
    const g = this.ghost;
    g.clear();

    const cx = shelf.slotCentreX(slot, slots);
    const w = slots * SLOT_W - 10;
    const y = shelf.surfaceY - PKG_H;
    const color = kind === 'ok' ? COLORS.good : kind === 'crush' ? COLORS.warn : COLORS.bad;

    g.fillStyle(color, 0.18);
    g.fillRoundedRect(cx - w / 2, y, w, PKG_H, 8);
    g.lineStyle(4, color, 0.95);
    g.strokeRoundedRect(cx - w / 2, y, w, PKG_H, 8);

    // Landing pad on the plank.
    g.fillStyle(color, 0.75);
    g.fillRoundedRect(cx - w / 2 + 4, shelf.surfaceY - 6, w - 8, 6, 3);

    // Down arrow so the target is obvious even under a finger.
    g.fillStyle(color, 0.95);
    g.fillTriangle(cx - 13, y - 20, cx + 13, y - 20, cx, y - 4);
    g.setVisible(true);
  }

  hideGhost() {
    this.ghost.clear();
  }

  /**
   * Vertical "no heavy cargo" bands above every placed fragile crate. This is
   * what stops the crush rule from ever feeling like a hidden trap.
   */
  updateCrushColumns(placed: CargoPackage[], emphasise: boolean) {
    const g = this.columns;
    g.clear();
    const alpha = emphasise ? 0.3 : 0.11;
    for (const p of placed) {
      if (p.type !== 'fragile' || p.shelf < 0) continue;
      if (p.shelf >= this.shelves.length - 1) continue;
      const shelf = this.shelves[p.shelf];
      const cx = shelf.slotCentreX(p.slot, p.slots);
      const w = p.slots * SLOT_W - 12;
      const top = this.topY + 18;
      const bottom = shelf.surfaceY - PKG_H;

      g.fillStyle(COLORS.fragileBand, alpha);
      g.fillRect(cx - w / 2, top, w, bottom - top);
      g.lineStyle(2, COLORS.fragileBand, alpha * 2.2);
      for (const x of [cx - w / 2, cx + w / 2]) {
        for (let y = top; y < bottom; y += 22) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x, Math.min(y + 11, bottom));
          g.strokePath();
        }
      }
    }
  }

  // --- tilt -----------------------------------------------------------------

  setBalance(net: number, tolerance: number, danger: boolean) {
    const ratio = Phaser.Math.Clamp(net / (tolerance * 2), -1, 1);
    this.targetRotation = Phaser.Math.DegToRad(ratio * MAX_TILT_DEG);
    this.wobble = danger ? 1 : 0;
  }

  tick(deltaMs: number) {
    const k = 1 - Math.pow(0.0015, deltaMs / 1000);
    let target = this.targetRotation;
    if (this.wobble > 0) {
      this.wobblePhase += deltaMs / 1000;
      target += Math.sin(this.wobblePhase * 11) * Phaser.Math.DegToRad(0.55);
    }
    this.container.rotation += (target - this.container.rotation) * k;
  }

  /** Quick squash of pride when the level is cleared. */
  celebrate() {
    this.scene.tweens.add({
      targets: this.container,
      scaleX: this.scale * 1.03,
      scaleY: this.scale * 1.03,
      duration: 170,
      yoyo: true,
      onComplete: () => this.container.setScale(this.scale),
    });
  }

  /** Snaps the rack over hard. Cargo detachment is handled by the caller. */
  collapse(direction: number, onDone: () => void) {
    this.scene.tweens.add({
      targets: this.container,
      rotation: Phaser.Math.DegToRad(direction * 26),
      duration: 420,
      ease: 'Back.easeIn',
      onComplete: () => {
        this.scene.tweens.add({
          targets: this.container,
          rotation: Phaser.Math.DegToRad(direction * 21),
          y: this.container.y + 14,
          duration: 220,
          ease: 'Bounce.easeOut',
          onComplete: onDone,
        });
      },
    });
    this.wobble = 0;
  }

  destroy() {
    for (const s of this.shelves) s.destroy();
    this.container.destroy();
  }
}
