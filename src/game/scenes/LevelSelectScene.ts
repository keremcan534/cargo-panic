/**
 * Level grid. Five columns of five, each tile showing its star rating; locked
 * levels are dimmed until the previous one is cleared.
 */

import Phaser from 'phaser';
import { COLORS, FONT, HEX } from '../config';
import { LEVELS, TOTAL_LEVELS } from '../levels/levels';
import { audio } from '../systems/AudioManager';
import { haptics } from '../systems/Haptics';
import { progress } from '../systems/ProgressManager';
import { gridGeometry } from '../layout';
import { applyCameraGrade, useLogicalCamera } from '../render';
import { registerTap, TAP_LAYER } from '../ui/TapManager';
import type { Tappable } from '../ui/TapManager';
import { TEX_SCALE } from '../textures';
import { drawBackdrop } from '../ui/Backdrop';
import { Button, IconButton } from '../ui/Button';

const COLS = 5;
const TILE = 118;

export class LevelSelectScene extends Phaser.Scene {
  constructor() {
    super('LevelSelect');
  }

  create() {
    const { w, h } = useLogicalCamera(this);
    this.cameras.main.fadeIn(220, 13, 17, 23);
    applyCameraGrade(this);
    drawBackdrop(this, w, h);

    this.add
      .text(w / 2, 62, 'SELECT LEVEL', {
        fontFamily: FONT,
        fontSize: '38px',
        fontStyle: 'bold',
        color: HEX.text,
      })
      .setOrigin(0.5)
      .setDepth(10);

    const stars = progress.totalStars();
    this.add
      .text(w / 2, 104, `${stars} / ${TOTAL_LEVELS * 3} STARS COLLECTED`, {
        fontFamily: FONT,
        fontSize: '19px',
        fontStyle: 'bold',
        color: HEX.gold,
      })
      .setOrigin(0.5)
      .setDepth(10);

    new IconButton(this, 54, 60, 50, 'back', () => this.scene.start('Menu')).setDepth(10);

    const geo = gridGeometry(h);
    LEVELS.forEach((level, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      this.buildTile(
        geo.x0 + col * (TILE + geo.colGap),
        geo.y0 + row * (TILE + geo.rowGap),
        level.id,
      );
    });

    const next = progress.unlocked;
    new Button(this, {
      x: w / 2,
      y: geo.footerTop + 76,
      width: 470,
      height: 76,
      label: progress.completedCount() === 0 ? 'START LEVEL 1' : `CONTINUE - LEVEL ${next}`,
      style: 'primary',
      fontSize: 28,
      onClick: () => {
        this.cameras.main.fadeOut(180, 13, 17, 23);
        this.cameras.main.once('camerafadeoutcomplete', () =>
          this.scene.start('Game', { levelId: next }),
        );
      },
    }).setDepth(10);

    this.add
      .text(w / 2, h - 26, 'Clear a level to unlock the next one', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#5c6d84',
      })
      .setOrigin(0.5)
      .setDepth(10);
  }

  private buildTile(x: number, y: number, id: number) {
    const unlocked = progress.isUnlocked(id);
    const stars = progress.starsFor(id);
    const half = TILE / 2;

    const g = this.add.graphics().setDepth(10);
    const draw = (pressed: boolean) => {
      g.clear();
      const off = pressed ? 3 : 0;
      if (!pressed) {
        g.fillStyle(0x000000, 0.4);
        g.fillRoundedRect(x - half, y - half + 6, TILE, TILE, 18);
      }
      if (!unlocked) {
        g.fillStyle(0x141b25, 1);
        g.fillRoundedRect(x - half, y - half + off, TILE, TILE, 18);
        g.lineStyle(2, 0x222c39, 1);
        g.strokeRoundedRect(x - half, y - half + off, TILE, TILE, 18);
        return;
      }
      const base = stars > 0 ? 0x233247 : 0x2b3648;
      g.fillStyle(0x141c27, 1);
      g.fillRoundedRect(x - half, y - half + off, TILE, TILE, 18);
      g.fillStyle(base, 1);
      g.fillRoundedRect(x - half, y - half + off, TILE, TILE - 6, 18);
      g.lineStyle(2, stars === 3 ? COLORS.gold : COLORS.accent, stars > 0 ? 0.9 : 0.45);
      g.strokeRoundedRect(x - half + 1, y - half + off + 1, TILE - 2, TILE - 8, 17);
    };
    draw(false);

    if (!unlocked) {
      // Padlock pictogram.
      const lock = this.add.graphics().setDepth(11);
      lock.fillStyle(0x3a4658, 1);
      lock.fillRoundedRect(x - 15, y - 6, 30, 24, 5);
      lock.lineStyle(5, 0x3a4658, 1);
      lock.beginPath();
      lock.arc(x, y - 8, 10, Phaser.Math.DegToRad(180), Phaser.Math.DegToRad(360), false);
      lock.strokePath();
      return;
    }

    this.add
      .text(x, y - 16, String(id), {
        fontFamily: FONT,
        fontSize: '40px',
        fontStyle: 'bold',
        color: stars > 0 ? HEX.text : HEX.textDim,
      })
      .setOrigin(0.5)
      .setDepth(11);

    for (let s = 0; s < 3; s++) {
      this.add
        .image(x + (s - 1) * 26, y + 26, s < stars ? 'star_small_on' : 'star_small_off')
        .setScale(0.66 / TEX_SCALE)
        .setDepth(11);
    }

    // Hit testing goes through the tap router so the tiles respond to touch.
    const half2 = TILE / 2;
    const tile: Tappable = {
      tapLayer: TAP_LAYER.ui,
      tapEnabled: () => true,
      tapHitTest: (px, py) => Math.abs(px - x) <= half2 && Math.abs(py - y) <= half2,
      tapPress: (down) => {
        draw(down);
        if (down) audio.unlock();
      },
      tapActivate: () => {
        audio.click();
        haptics.tap();
        this.cameras.main.fadeOut(180, 13, 17, 23);
        this.cameras.main.once('camerafadeoutcomplete', () =>
          this.scene.start('Game', { levelId: id }),
        );
      },
    };
    registerTap(this, tile);
  }
}
