/**
 * The intake belt. Holds the package currently in hand plus a two-deep preview
 * of what is coming, and nothing more - a long queue would turn a calm puzzle
 * into a memory test.
 */

import Phaser from 'phaser';
import { COLORS, FONT, HEX, PKG_H } from '../config';
import type { Layout } from '../layout';
import { TEX_SCALE } from '../textures';

/** Preview scale for the "up next" tray. */
export const PREVIEW_SCALE = 0.5;

/** Above the backdrop, below the HUD. */
const DEPTH = 20;

const BELT_X0 = 20;
const BELT_X1 = 404;
const TRAY_X0 = 418;
const TRAY_X1 = 700;

export class Conveyor {
  readonly liveX: number;
  readonly liveBottomY: number;
  readonly previewX: [number, number];
  readonly previewY: number;

  private belt: Phaser.GameObjects.TileSprite;
  private rails: Phaser.GameObjects.Graphics;
  private tray: Phaser.GameObjects.Graphics;
  private emptyText: Phaser.GameObjects.Text;
  private speed = 34;

  constructor(scene: Phaser.Scene, layout: Layout) {
    const surface = layout.conveyorY;
    const h = layout.conveyorH;

    this.liveX = (BELT_X0 + BELT_X1) / 2;
    this.liveBottomY = surface;
    this.previewX = [495, 628];
    this.previewY = surface - 28;

    this.rails = scene.add.graphics().setDepth(DEPTH);
    this.rails.fillStyle(0x0a0e14, 0.85);
    this.rails.fillRoundedRect(BELT_X0 - 6, surface - 8, BELT_X1 - BELT_X0 + 12, h + 20, 10);

    this.belt = scene.add
      .tileSprite(BELT_X0, surface, BELT_X1 - BELT_X0, h, 'belt_tile')
      .setOrigin(0, 0)
      .setDepth(DEPTH);
    this.belt.setTileScale(1 / TEX_SCALE, 1 / TEX_SCALE);

    const trim = scene.add.graphics().setDepth(DEPTH + 1);
    trim.fillStyle(COLORS.frameLight, 1);
    trim.fillRoundedRect(BELT_X0 - 6, surface - 8, BELT_X1 - BELT_X0 + 12, 8, 4);
    trim.fillStyle(COLORS.frameDark, 1);
    trim.fillRoundedRect(BELT_X0 - 6, surface + h, BELT_X1 - BELT_X0 + 12, 10, 4);
    // Roller ends.
    trim.fillStyle(COLORS.frameLight, 1);
    for (const x of [BELT_X0 - 2, BELT_X1 - 10]) {
      trim.fillRoundedRect(x, surface + 2, 12, h - 4, 6);
    }

    this.tray = scene.add.graphics().setDepth(DEPTH);
    this.tray.fillStyle(COLORS.panel, 0.9);
    this.tray.fillRoundedRect(TRAY_X0, surface - PKG_H - 16, TRAY_X1 - TRAY_X0, PKG_H + h + 26, 14);
    this.tray.lineStyle(2, COLORS.panelEdge, 1);
    this.tray.strokeRoundedRect(
      TRAY_X0,
      surface - PKG_H - 16,
      TRAY_X1 - TRAY_X0,
      PKG_H + h + 26,
      14,
    );

    scene.add
      .text(TRAY_X0 + 14, surface - PKG_H - 2, 'UP NEXT', {
        fontFamily: FONT,
        fontSize: '16px',
        fontStyle: 'bold',
        color: HEX.textDim,
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH + 1);

    this.emptyText = scene.add
      .text(this.liveX, surface - PKG_H / 2 - 4, 'BELT CLEAR', {
        fontFamily: FONT,
        fontSize: '24px',
        fontStyle: 'bold',
        color: HEX.textDim,
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(DEPTH + 1);
  }

  /** Scene y for the centre of a full-size package sitting on the belt. */
  get liveCentreY() {
    return this.liveBottomY - PKG_H / 2;
  }

  setEmpty(on: boolean) {
    this.emptyText.setAlpha(on ? 0.65 : 0);
  }

  /** Belt slows to a crawl while the player is dragging, so nothing distracts. */
  setDragging(on: boolean) {
    this.speed = on ? 8 : 34;
  }

  tick(deltaMs: number) {
    this.belt.tilePositionX -= (this.speed * deltaMs) / 1000;
  }

  destroy() {
    this.belt.destroy();
    this.rails.destroy();
    this.tray.destroy();
    this.emptyText.destroy();
  }
}
