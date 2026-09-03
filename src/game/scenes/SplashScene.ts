/**
 * BlackBlue Studios ident. Tap anywhere to skip.
 */

import Phaser from 'phaser';
import { FONT, HEX } from '../config';
import { useLogicalCamera } from '../render';

export class SplashScene extends Phaser.Scene {
  private done = false;

  constructor() {
    super('Splash');
  }

  create() {
    const { w, h } = useLogicalCamera(this);
    this.cameras.main.setBackgroundColor('#0d1117');

    const mark = this.add.container(w / 2, h / 2 - 10);

    const black = this.add
      .text(0, 0, 'BLACK', {
        fontFamily: FONT,
        fontSize: '62px',
        fontStyle: 'bold',
        color: HEX.text,
      })
      .setOrigin(1, 0.5);
    const blue = this.add
      .text(0, 0, 'BLUE', {
        fontFamily: FONT,
        fontSize: '62px',
        fontStyle: 'bold',
        color: HEX.accent,
      })
      .setOrigin(0, 0.5);
    const sub = this.add
      .text(0, 52, 'S T U D I O S', {
        fontFamily: FONT,
        fontSize: '22px',
        color: HEX.textDim,
      })
      .setOrigin(0.5);

    mark.add([black, blue, sub]);

    black.setAlpha(0).setX(-40);
    blue.setAlpha(0).setX(40);
    sub.setAlpha(0);

    this.tweens.add({ targets: black, alpha: 1, x: -4, duration: 520, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: blue, alpha: 1, x: 4, duration: 520, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: sub, alpha: 1, duration: 500, delay: 340 });

    // A sweep of light across the wordmark.
    const shine = this.add
      .rectangle(w / 2 - 320, h / 2 - 10, 90, 150, 0xffffff, 0.13)
      .setAngle(18)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: shine,
      x: w / 2 + 320,
      duration: 900,
      delay: 500,
      ease: 'Quad.easeInOut',
      onComplete: () => shine.destroy(),
    });

    this.time.delayedCall(2000, () => this.finish());
    this.input.once('pointerdown', () => this.finish());
  }

  private finish() {
    if (this.done) return;
    this.done = true;
    this.cameras.main.fadeOut(260, 13, 17, 23);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Menu'));
  }
}
