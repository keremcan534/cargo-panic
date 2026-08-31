/**
 * Bakes every runtime texture, then hands off to the studio splash. There are
 * no external assets to load, so this scene never blocks on the network.
 */

import Phaser from 'phaser';
import { generateTextures } from '../textures';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    generateTextures(this);

    // Retire the pre-Phaser HTML splash now that we can paint.
    const el = document.getElementById('boot-splash');
    if (el) {
      el.classList.add('hidden');
      window.setTimeout(() => el.remove(), 500);
    }

    this.scene.start('Splash');
  }
}
