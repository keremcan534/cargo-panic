/**
 * One shelf tier: the plank itself, its gold destination zone, its sealed-off
 * state, and the instrument row underneath showing leverage and live load.
 */

import Phaser from 'phaser';
import {
  COLORS,
  FONT,
  HEX,
  PKG_H,
  SHELF_SPACING,
  SHELF_THICKNESS,
  SLOT_W,
  TIER_LEVERAGE_STEP,
} from '../config';
import { tierLeverage } from '../levels/types';
import type { ShelfDef } from '../levels/types';

export class Shelf {
  readonly tier: number;
  readonly def: ShelfDef;
  readonly width: number;
  /** Local y of the plank's top surface inside the rack container. */
  readonly surfaceY: number;
  readonly leverage: number;

  private plank: Phaser.GameObjects.Graphics;
  private loadBar: Phaser.GameObjects.Graphics;
  private loadText: Phaser.GameObjects.Text;
  private warnGlow: Phaser.GameObjects.Graphics;
  private zoneGfx?: Phaser.GameObjects.Graphics;
  private warnTween?: Phaser.Tweens.Tween;
  private flexTween?: Phaser.Tweens.Tween;

  private barX0 = 0;
  private barX1 = 0;
  private load = 0;
  /** Extra decoration built during drawing, parented once at the end. */
  private extras: Phaser.GameObjects.GameObject[] = [];

  constructor(
    private scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
    tier: number,
    def: ShelfDef,
    rackHalfW: number,
  ) {
    this.tier = tier;
    this.def = def;
    this.width = def.slots * SLOT_W;
    this.surfaceY = -tier * SHELF_SPACING;
    this.leverage = tierLeverage(tier, TIER_LEVERAGE_STEP);

    this.warnGlow = scene.add.graphics();
    this.plank = scene.add.graphics();
    this.loadBar = scene.add.graphics();

    const rowY = this.surfaceY + SHELF_THICKNESS + 17;
    const half = this.width / 2;

    const levPill = scene.add.graphics();
    levPill.fillStyle(0x111823, 0.95);
    levPill.fillRoundedRect(-half, rowY - 11, 60, 22, 8);
    levPill.lineStyle(1.5, tier === 0 ? COLORS.panelEdge : COLORS.accent, 0.75);
    levPill.strokeRoundedRect(-half, rowY - 11, 60, 22, 8);
    const levText = scene.add
      .text(-half + 30, rowY, `x${this.leverage.toFixed(2)}`, {
        fontFamily: FONT,
        fontSize: '15px',
        fontStyle: 'bold',
        color: tier === 0 ? HEX.textDim : HEX.accent,
      })
      .setOrigin(0.5);

    this.loadText = scene.add
      .text(half, rowY, `0/${def.maxWeight}`, {
        fontFamily: FONT,
        fontSize: '16px',
        fontStyle: 'bold',
        color: HEX.textDim,
      })
      .setOrigin(1, 0.5);

    this.barX0 = -half + 70;
    this.barX1 = half - 54;

    this.drawPlank(rackHalfW);
    this.drawZone();
    this.refreshLoadBar();

    container.add([this.warnGlow, this.plank, levPill, levText, this.loadBar, this.loadText]);
    if (this.zoneGfx) container.add(this.zoneGfx);
    if (this.extras.length) container.add(this.extras);
    this.extras = [];
  }

  // --- geometry -------------------------------------------------------------

  /** Local x of the centre of a package occupying `slots` slots from `slot`. */
  slotCentreX(slot: number, slots: number): number {
    return (slot + slots / 2 - this.def.slots / 2) * SLOT_W;
  }

  /** Nearest legal start slot for a package of `slots` width at local x. */
  slotFromX(localX: number, slots: number): number {
    const raw = localX / SLOT_W + this.def.slots / 2 - slots / 2;
    return Phaser.Math.Clamp(Math.round(raw), 0, this.def.slots - slots);
  }

  /** Vertical centre of a package resting on this shelf. */
  get packageCentreY(): number {
    return this.surfaceY - PKG_H / 2;
  }

  // --- drawing --------------------------------------------------------------

  private drawPlank(rackHalfW: number) {
    const g = this.plank;
    const half = this.width / 2;
    const y = this.surfaceY;
    const th = SHELF_THICKNESS;

    // Brackets tying the plank back into the uprights.
    g.fillStyle(COLORS.frameDark, 1);
    g.fillRect(-rackHalfW, y + 1, rackHalfW - half + 2, th - 3);
    g.fillRect(half - 2, y + 1, rackHalfW - half + 2, th - 3);

    // Visible top face, peeking out from behind the cargo. Graded from the
    // lamps at the back towards the lip at the front.
    const inset = 9;
    const depth = 6;
    for (let i = 0; i < depth; i++) {
      const t = i / depth;
      g.fillStyle(Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(COLORS.shelfTopLit),
        Phaser.Display.Color.IntegerToColor(COLORS.shelfTop),
        depth,
        i,
      ).color, 1);
      const w0 = inset * (1 - t);
      g.fillRect(-half + w0, y - depth + i, this.width - w0 * 2, 1.2);
    }

    // Front face, banded into a smooth vertical gradient.
    const bands = 6;
    for (let i = 0; i < bands; i++) {
      g.fillStyle(Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(COLORS.shelfFace),
        Phaser.Display.Color.IntegerToColor(COLORS.shelfDark),
        bands,
        i,
      ).color, 1);
      g.fillRect(-half, y + (th / bands) * i, this.width, th / bands + 0.6);
    }

    // Specular lip along the top edge, and a dark seam under the top face.
    g.fillStyle(0x000000, 0.35);
    g.fillRect(-half, y, this.width, 1.5);
    g.fillStyle(0xdfeaf7, 0.5);
    g.fillRect(-half + 3, y + 1.5, this.width - 6, 1.8);

    // Rounded end caps so the plank does not read as a bare rectangle.
    g.fillStyle(COLORS.frameLight, 1);
    g.fillRoundedRect(-half - 2, y + 1, 5, th - 2, 2);
    g.fillRoundedRect(half - 3, y + 1, 5, th - 2, 2);

    // Drop shadow cast onto the tier below.
    g.fillStyle(0x000000, 0.34);
    g.fillRect(-half + 6, y + th, this.width - 12, 4);
    g.fillStyle(0x000000, 0.16);
    g.fillRect(-half + 10, y + th + 4, this.width - 20, 4);

    if (this.def.locked) this.drawSealed();
  }

  private drawSealed() {
    const g = this.plank;
    const half = this.width / 2;
    const y = this.surfaceY;
    const top = y - PKG_H;

    g.fillStyle(0x1a0f08, 0.75);
    g.fillRect(-half, top, this.width, PKG_H);

    g.lineStyle(9, COLORS.locked, 1);
    for (const dy of [0, PKG_H * 0.62]) {
      g.beginPath();
      g.moveTo(-half + 6, top + 14 + dy);
      g.lineTo(half - 6, top + 2 + dy);
      g.strokePath();
    }
    g.lineStyle(2, 0x000000, 0.4);
    g.strokeRect(-half, top, this.width, PKG_H);

    this.extras.push(
      this.scene.add
        .text(0, top + PKG_H / 2, 'OUT OF SERVICE', {
          fontFamily: FONT,
          fontSize: '21px',
          fontStyle: 'bold',
          color: '#e8b083',
        })
        .setOrigin(0.5)
        .setAngle(-2),
    );
  }

  private drawZone() {
    const zone = this.def.zone;
    if (!zone || this.def.locked) return;
    const g = this.scene.add.graphics();
    const x0 = (zone.from - this.def.slots / 2) * SLOT_W;
    const w = (zone.to - zone.from) * SLOT_W;
    const y = this.surfaceY;

    g.fillStyle(COLORS.zone, 0.13);
    g.fillRect(x0, y - PKG_H, w, PKG_H);
    g.fillStyle(COLORS.zone, 0.4);
    g.fillRect(x0 + 3, y - 5, w - 6, 5);

    g.lineStyle(3, COLORS.zone, 0.7);
    const dash = 13;
    for (const yy of [y - PKG_H]) {
      for (let x = x0 + 2; x < x0 + w - 4; x += dash * 2) {
        g.beginPath();
        g.moveTo(x, yy);
        g.lineTo(Math.min(x + dash, x0 + w - 4), yy);
        g.strokePath();
      }
    }
    for (const xx of [x0 + 1.5, x0 + w - 1.5]) {
      for (let yy = y - PKG_H; yy < y; yy += dash * 2) {
        g.beginPath();
        g.moveTo(xx, yy);
        g.lineTo(xx, Math.min(yy + dash, y));
        g.strokePath();
      }
    }

    this.extras.push(
      this.scene.add
        .text(x0 + w / 2, y - PKG_H - 14, 'PRIORITY', {
          fontFamily: FONT,
          fontSize: '15px',
          fontStyle: 'bold',
          color: HEX.gold,
        })
        .setOrigin(0.5),
    );

    this.zoneGfx = g;
  }

  private refreshLoadBar() {
    const g = this.loadBar;
    const rowY = this.surfaceY + SHELF_THICKNESS + 17;
    const w = this.barX1 - this.barX0;
    g.clear();

    g.fillStyle(0x0a0e14, 0.9);
    g.fillRoundedRect(this.barX0, rowY - 7, w, 14, 6);

    const ratio = this.def.maxWeight > 0 ? this.load / this.def.maxWeight : 0;
    const over = ratio > 1;
    const c = over ? COLORS.bad : ratio > 0.75 ? COLORS.warn : COLORS.good;
    const fw = Math.max(0, Math.min(1, ratio)) * (w - 4);
    if (fw > 0) {
      g.fillStyle(c, 1);
      g.fillRoundedRect(this.barX0 + 2, rowY - 5, fw, 10, 5);
    }
    if (over) {
      g.lineStyle(2, COLORS.bad, 1);
      g.strokeRoundedRect(this.barX0, rowY - 7, w, 14, 6);
    }

    this.loadText.setText(`${this.load}/${this.def.maxWeight}`);
    this.loadText.setColor(over ? HEX.bad : ratio > 0.75 ? HEX.warn : HEX.textDim);
  }

  // --- state ----------------------------------------------------------------

  setLoad(weight: number) {
    if (weight === this.load) return;
    this.load = weight;
    this.refreshLoadBar();
  }

  /** Red glow behind the plank while this shelf is over its weight limit. */
  setOverloaded(on: boolean) {
    if (on === !!this.warnTween) return;
    if (on) {
      const half = this.width / 2;
      const g = this.warnGlow;
      g.clear();
      g.fillStyle(COLORS.bad, 0.3);
      g.fillRoundedRect(-half - 12, this.surfaceY - 8, this.width + 24, SHELF_THICKNESS + 24, 10);
      g.setAlpha(0);
      this.warnTween = this.scene.tweens.add({
        targets: g,
        alpha: 1,
        duration: 300,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else {
      this.warnTween?.remove();
      this.warnTween = undefined;
      this.warnGlow.clear();
      this.warnGlow.setAlpha(1);
    }
  }

  /** Plank flexes down under a landing package, then springs back. */
  flex(strength: number) {
    this.flexTween?.remove();
    this.plank.y = 0;
    this.flexTween = this.scene.tweens.add({
      targets: this.plank,
      y: Math.min(7, 1.4 * strength),
      duration: 80,
      yoyo: true,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.plank.y = 0;
        this.flexTween = undefined;
      },
    });
  }

  destroy() {
    this.warnTween?.remove();
    this.flexTween?.remove();
  }
}
