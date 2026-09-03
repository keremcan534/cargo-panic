/**
 * Shared warehouse backdrop.
 *
 * Built in depth layers rather than as one flat wall: a graded far wall, two
 * ranks of silhouetted racking with rim light on their top edges, a lit floor
 * with a gloss band, and a warm pool of light where the player's rack stands.
 * All vector drawing, so it stays sharp at any render scale.
 */

import Phaser from 'phaser';
import { COLORS } from '../config';

export interface BackdropOpts {
  /** Y of the floor line. Omit for a floorless (menu-grid) backdrop. */
  floorY?: number;
  /** Hanging lamps with visible housings at the top of the screen. */
  lamps?: boolean;
  /** Distant racking silhouettes behind the action. */
  silhouettes?: boolean;
  /** Warm pool of light centred on the play area. */
  lightPool?: boolean;
}

export function drawBackdrop(scene: Phaser.Scene, w: number, h: number, opts: BackdropOpts = {}) {
  const { floorY, lamps = false, silhouettes = false, lightPool = false } = opts;

  scene.add.image(w / 2, h / 2, 'bg_grad').setDisplaySize(w, h).setDepth(0);

  const far = scene.add.graphics().setDepth(1);
  const near = scene.add.graphics().setDepth(2);

  // Corrugated wall panels, fading out towards the floor so the wall reads as
  // receding rather than as a flat sheet.
  const wallBottom = floorY ?? h;
  for (let x = 0; x < w; x += 92) {
    far.fillStyle(0xffffff, 0.016);
    far.fillRect(x, 0, 44, wallBottom * 0.72);
    far.fillStyle(0xffffff, 0.008);
    far.fillRect(x, wallBottom * 0.72, 44, wallBottom * 0.28);
  }

  if (silhouettes && floorY !== undefined) {
    // Two ranks: the far one is flatter and dimmer, the near one carries a
    // faint rim light along its shelf edges.
    const ranks: { x: number; frac: number; w: number; near: boolean }[] = [
      { x: -40, frac: 0.66, w: 168, near: false },
      { x: w - 186, frac: 0.74, w: 206, near: false },
      { x: 128, frac: 0.42, w: 104, near: true },
      { x: w - 268, frac: 0.36, w: 96, near: true },
    ];

    for (const r of ranks) {
      const g = r.near ? near : far;
      const sh = Math.max(150, floorY * r.frac);
      const y = floorY - sh;
      const body = r.near ? 0x0c141d : 0x0a1018;
      const alpha = r.near ? 0.62 : 0.4;

      g.fillStyle(body, alpha);
      g.fillRect(r.x, y, r.w, sh);

      // Uprights.
      g.fillStyle(0x060b11, alpha * 0.8);
      g.fillRect(r.x + 5, y, 10, sh);
      g.fillRect(r.x + r.w - 15, y, 10, sh);

      // Shelf planks, with a lit top edge on the nearer rank.
      for (let yy = y + 66; yy < floorY - 24; yy += 152) {
        g.fillStyle(0x1d2836, alpha * 1.1);
        g.fillRect(r.x, yy, r.w, 7);
        if (r.near) {
          g.fillStyle(0x3d4f66, 0.5);
          g.fillRect(r.x, yy, r.w, 2);
        }
      }
      g.fillStyle(0x28374a, alpha * 0.9);
      g.fillRect(r.x, y, r.w, 3);
    }
  }

  if (floorY !== undefined) {
    const floor = scene.add.graphics().setDepth(3);
    floor.fillStyle(COLORS.floor, 1);
    floor.fillRect(0, floorY, w, h - floorY);

    // Lit lip where wall meets floor, then a short gloss falloff.
    floor.fillStyle(0x33445c, 1);
    floor.fillRect(0, floorY, w, 3);
    for (let i = 0; i < 10; i++) {
      floor.fillStyle(0xffffff, 0.018 * (1 - i / 10));
      floor.fillRect(0, floorY + 3 + i * 5, w, 5);
    }
    floor.fillStyle(0x000000, 0.3);
    floor.fillRect(0, floorY + 3, w, 6);

    // Painted aisle markings receding towards a vanishing point.
    floor.lineStyle(3, 0xf0a53c, 0.06);
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      floor.beginPath();
      floor.moveTo(w / 2 + i * 48, floorY);
      floor.lineTo(w / 2 + i * 210, h);
      floor.strokePath();
    }
  }

  if (lightPool && floorY !== undefined) {
    // Warm pool the rack stands in, plus a soft contact shadow on the floor.
    scene.add
      .image(w / 2, floorY - 210, 'fx_glow')
      .setDisplaySize(w * 1.5, 620)
      .setDepth(4)
      .setAlpha(0.14)
      .setTint(0xffd9a0)
      .setBlendMode(Phaser.BlendModes.ADD);

    scene.add
      .image(w / 2, floorY + 16, 'fx_glow')
      .setDisplaySize(w * 1.2, 110)
      .setDepth(5)
      .setAlpha(0.34)
      .setTint(0x000000);
  }

  if (lamps) {
    for (const lx of [w * 0.2, w * 0.5, w * 0.8]) {
      const lamp = scene.add
        .image(lx, 20, 'fx_lamp')
        .setOrigin(0.5, 0)
        .setDisplaySize(360, (floorY ?? h * 0.8) * 0.86)
        .setDepth(6)
        .setAlpha(0.5)
        .setBlendMode(Phaser.BlendModes.ADD);
      scene.tweens.add({
        targets: lamp,
        alpha: { from: 0.4, to: 0.58 },
        duration: 2400 + Math.random() * 1100,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      const housing = scene.add.graphics().setDepth(7);
      housing.fillStyle(0x1e2733, 1);
      housing.fillRect(lx - 2, 0, 4, 24);
      housing.fillStyle(0x334054, 1);
      housing.beginPath();
      housing.moveTo(lx - 30, 46);
      housing.lineTo(lx - 13, 22);
      housing.lineTo(lx + 13, 22);
      housing.lineTo(lx + 30, 46);
      housing.closePath();
      housing.fillPath();
      housing.fillStyle(0x4a5a72, 1);
      housing.fillRect(lx - 30, 44, 60, 3);

      // The bulb itself, with a bloom around it.
      scene.add
        .image(lx, 47, 'fx_glow')
        .setDisplaySize(130, 90)
        .setDepth(8)
        .setAlpha(0.5)
        .setTint(0xffd28a)
        .setBlendMode(Phaser.BlendModes.ADD);
      const bulb = scene.add.graphics().setDepth(9);
      bulb.fillStyle(0xfff0cf, 0.95);
      bulb.fillEllipse(lx, 47, 52, 11);
    }
  } else {
    // No visible fittings, just a warm wash from off-screen lighting.
    scene.add
      .image(w / 2, -30, 'fx_lamp')
      .setOrigin(0.5, 0)
      .setDisplaySize(w * 1.6, (floorY ?? h) * 0.9)
      .setDepth(6)
      .setAlpha(0.32)
      .setBlendMode(Phaser.BlendModes.ADD);
  }
}
