/**
 * Title screen. Shows the wordmark over a little animated rack, the player's
 * progress so far, and the two ways in.
 */

import Phaser from 'phaser';
import { COLORS, FONT, HEX, PKG_H } from '../config';
import { TOTAL_LEVELS } from '../levels/levels';
import { applyCameraGrade, useLogicalCamera } from '../render';
import { audio } from '../systems/AudioManager';
import { progress } from '../systems/ProgressManager';
import { formatScore, newRun, seedFromUrl } from '../systems/RunManager';
import { pkgTextureKey, TEX_SCALE } from '../textures';
import { drawBackdrop } from '../ui/Backdrop';
import { Button, IconButton } from '../ui/Button';

export class MenuScene extends Phaser.Scene {
  private soundBtn?: IconButton;

  constructor() {
    super('Menu');
  }

  create() {
    const { w, h } = useLogicalCamera(this);
    this.cameras.main.fadeIn(260, 13, 17, 23);
    applyCameraGrade(this);

    drawBackdrop(this, w, h, {
      floorY: h * 0.8,
      lamps: true,
      silhouettes: true,
      lightPool: true,
    });
    this.buildHeroRack(w, h * 0.5);

    // --- wordmark -----------------------------------------------------------
    const titleY = h * 0.17;
    const cargo = this.add
      .text(w / 2, titleY, 'CARGO', {
        fontFamily: FONT,
        fontSize: '84px',
        fontStyle: 'bold',
        color: HEX.text,
      })
      .setOrigin(0.5)
      .setDepth(20);
    cargo.setShadow(0, 6, '#04070b', 10, false, true);

    const panic = this.add
      .text(w / 2, titleY + 74, 'PANIC', {
        fontFamily: FONT,
        fontSize: '84px',
        fontStyle: 'bold',
        color: HEX.accentWarm,
      })
      .setOrigin(0.5)
      .setDepth(20);
    panic.setShadow(0, 6, '#04070b', 10, false, true);

    this.add
      .text(w / 2, titleY + 136, 'PACK THE WAREHOUSE WITHOUT TIPPING THE SHELVES', {
        fontFamily: FONT,
        fontSize: '18px',
        fontStyle: 'bold',
        color: HEX.textDim,
        align: 'center',
        wordWrap: { width: 520 },
      })
      .setOrigin(0.5)
      .setDepth(20);

    this.tweens.add({
      targets: [cargo, panic],
      y: '-=7',
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // --- progress -----------------------------------------------------------
    const done = progress.completedCount();
    const stars = progress.totalStars();
    const chipY = h - 388;
    const g = this.add.graphics().setDepth(20);
    g.fillStyle(0x0b1017, 0.8);
    g.fillRoundedRect(w / 2 - 200, chipY - 26, 400, 52, 26);
    g.lineStyle(2, COLORS.panelEdge, 1);
    g.strokeRoundedRect(w / 2 - 200, chipY - 26, 400, 52, 26);

    this.add
      .image(w / 2 - 118, chipY, 'star_small_on')
      .setScale(0.72 / TEX_SCALE)
      .setDepth(21);
    this.add
      .text(w / 2 - 92, chipY, `${stars} / ${TOTAL_LEVELS * 3}`, {
        fontFamily: FONT,
        fontSize: '23px',
        fontStyle: 'bold',
        color: HEX.gold,
      })
      .setOrigin(0, 0.5)
      .setDepth(21);
    this.add
      .text(w / 2 + 150, chipY, `${done} / ${TOTAL_LEVELS} CLEARED`, {
        fontFamily: FONT,
        fontSize: '20px',
        fontStyle: 'bold',
        color: HEX.textDim,
      })
      .setOrigin(1, 0.5)
      .setDepth(21);

    // --- actions ------------------------------------------------------------
    const playLabel = done === 0 ? 'PLAY' : `CONTINUE - LEVEL ${progress.unlocked}`;
    new Button(this, {
      x: w / 2,
      y: h - 304,
      width: 470,
      height: 80,
      label: playLabel,
      style: 'primary',
      fontSize: done === 0 ? 38 : 30,
      onClick: () => this.startLevel(progress.unlocked),
    }).setDepth(20);

    const endless = progress.endless;
    this.add
      .text(
        w / 2,
        h - 244,
        endless.runs === 0
          ? 'PROCEDURAL WAVES - ONE MISTAKE ENDS A RUN'
          : `BEST ${formatScore(endless.bestScore)}  -  WAVE ${endless.bestWave}`,
        {
          fontFamily: FONT,
          fontSize: '16px',
          fontStyle: 'bold',
          color: endless.runs === 0 ? '#5c6d84' : HEX.gold,
        },
      )
      .setOrigin(0.5)
      .setDepth(20);

    new Button(this, {
      x: w / 2,
      y: h - 190,
      width: 470,
      height: 74,
      label: 'ENDLESS SHIFT',
      style: 'gold',
      fontSize: 30,
      onClick: () => this.startEndless(),
    }).setDepth(20);

    new Button(this, {
      x: w / 2,
      y: h - 96,
      width: 470,
      height: 60,
      label: 'LEVEL SELECT',
      style: 'secondary',
      fontSize: 26,
      onClick: () => this.scene.start('LevelSelect'),
    }).setDepth(20);

    this.soundBtn = new IconButton(
      this,
      w - 54,
      54,
      50,
      progress.soundOn ? 'sound-on' : 'sound-off',
      () => {
        const on = !progress.soundOn;
        audio.setEnabled(on);
        this.soundBtn?.setKind(on ? 'sound-on' : 'sound-off');
        if (on) audio.click();
      },
    );
    this.soundBtn.setDepth(20);

    this.add
      .text(w / 2, h - 26, 'BLACKBLUE STUDIOS', {
        fontFamily: FONT,
        fontSize: '15px',
        color: '#4b5b70',
      })
      .setOrigin(0.5)
      .setDepth(20);

    this.input.once('pointerdown', () => audio.unlock());
  }

  private startEndless() {
    this.cameras.main.fadeOut(200, 13, 17, 23);
    this.cameras.main.once('camerafadeoutcomplete', () =>
      this.scene.start('Game', { run: newRun(seedFromUrl()) }),
    );
  }

  private startLevel(id: number) {
    this.cameras.main.fadeOut(200, 13, 17, 23);
    this.cameras.main.once('camerafadeoutcomplete', () =>
      this.scene.start('Game', { levelId: id }),
    );
  }

  /** Decorative rack behind the title with a few packages gently swaying. */
  private buildHeroRack(w: number, y: number) {
    const c = this.add.container(w / 2, y).setDepth(10);
    const g = this.add.graphics();
    const halfW = 250;

    g.fillStyle(COLORS.frameDark, 1);
    for (const sx of [-1, 1]) g.fillRect(sx * halfW - 11, -150, 22, 300);
    g.fillStyle(COLORS.frameLight, 1);
    for (const sx of [-1, 1]) g.fillRect(sx * halfW - 11, -150, 6, 300);

    for (const sy of [-40, 130]) {
      g.fillStyle(COLORS.shelfTop, 1);
      g.fillRect(-halfW, sy - 8, halfW * 2, 8);
      g.fillStyle(COLORS.shelfFace, 1);
      g.fillRoundedRect(-halfW, sy, halfW * 2, 16, 4);
      g.fillStyle(COLORS.shelfDark, 1);
      g.fillRect(-halfW, sy + 9, halfW * 2, 7);
    }
    c.add(g);

    const cargo: [string, number, number][] = [
      ['heavy', -150, -40],
      ['standard', -68, -40],
      ['fragile', 68, -40],
      ['standard', 150, -40],
      ['long', -80, 130],
      ['priority', 110, 130],
    ];
    for (const [type, x, sy] of cargo) {
      const img = this.add
        .image(x, sy - PKG_H / 2, pkgTextureKey(type as never))
        .setScale(0.86 / TEX_SCALE);
      c.add(img);
    }

    this.tweens.add({
      targets: c,
      angle: { from: -1.1, to: 1.1 },
      duration: 3200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }
}
