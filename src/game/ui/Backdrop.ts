/**
 * Shared warehouse backdrop: dark gradient, a lit floor, hanging lamps and a
 * few silhouetted racks in the distance. Drawn once per scene at low depth.
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
}

export function drawBackdrop(
  scene: Phaser.Scene,
  w: number,
  h: number,
  opts: BackdropOpts = {},
) {
  const { floorY, lamps = false, silhouettes = false } = opts;

  scene.add.image(w / 2, h / 2, 'bg_grad').setDisplaySize(w, h).setDepth(0);

  const g = scene.add.graphics().setDepth(1);

  // Faint corrugated wall panels so the void has some texture.
  g.fillStyle(0xffffff, 0.014);
  for (let x = 0; x < w; x += 92) g.fillRect(x, 0, 44, floorY ?? h);

  if (silhouettes && floorY !== undefined) {
    const shapes: [number, number, number][] = [
      [-30, 0.62, 158],
      [136, 0.4, 96],
      [w - 172, 0.72, 196],
      [w - 258, 0.34, 88],
    ];
    for (const [x, frac, sw] of shapes) {
      const sh = Math.max(140, floorY * frac);
      const y = floorY - sh;
      g.fillStyle(0x0a1018, 0.45);
      g.fillRect(x, y, sw, sh);
      // Shelf lines every ~150px so they read as racking, not slabs.
      g.fillStyle(0x1d2836, 0.5);
      for (let yy = y + 62; yy < floorY - 20; yy += 150) g.fillRect(x, yy, sw, 6);
      g.fillStyle(0x1d2836, 0.45);
      g.fillRect(x, y, sw, 7);
      // Uprights.
      g.fillStyle(0x0a1018, 0.4);
      g.fillRect(x + 4, y, 9, sh);
      g.fillRect(x + sw - 13, y, 9, sh);
    }
  }

  if (floorY !== undefined) {
    g.fillStyle(COLORS.floor, 1);
    g.fillRect(0, floorY, w, h - floorY);
    g.fillStyle(0x222d3c, 1);
    g.fillRect(0, floorY, w, 4);
    g.fillStyle(0x000000, 0.25);
    g.fillRect(0, floorY + 4, w, 10);

    // Painted aisle markings receding towards a vanishing point.
    g.lineStyle(3, 0xf0a53c, 0.055);
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      g.beginPath();
      g.moveTo(w / 2 + i * 48, floorY);
      g.lineTo(w / 2 + i * 210, h);
      g.strokePath();
    }
  }

  if (lamps) {
    for (const lx of [w * 0.2, w * 0.5, w * 0.8]) {
      const lamp = scene.add
        .image(lx, 20, 'fx_lamp')
        .setOrigin(0.5, 0)
        .setDisplaySize(360, (floorY ?? h * 0.8) * 0.86)
        .setDepth(2)
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

      const housing = scene.add.graphics().setDepth(3);
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
      housing.fillStyle(0xffe0a8, 0.9);
      housing.fillEllipse(lx, 46, 52, 11);
    }
  } else {
    // No visible fittings, just a warm wash from off-screen lighting.
    scene.add
      .image(w / 2, -30, 'fx_lamp')
      .setOrigin(0.5, 0)
      .setDisplaySize(w * 1.6, (floorY ?? h) * 0.9)
      .setDepth(2)
      .setAlpha(0.32)
      .setBlendMode(Phaser.BlendModes.ADD);
  }
}
