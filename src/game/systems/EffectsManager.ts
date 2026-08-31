/**
 * Particles, shake and the danger vignette.
 *
 * Emitters are built once per scene and fired with `explode`, so nothing is
 * allocated during play. Counts are deliberately modest - the game targets 60fps
 * on mid-range Android hardware, not a particle showcase.
 */

import Phaser from 'phaser';
import { COLORS } from '../config';

export class EffectsManager {
  private dustFx: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparkFx: Phaser.GameObjects.Particles.ParticleEmitter;
  private glassFx: Phaser.GameObjects.Particles.ParticleEmitter;
  private debrisFx: Phaser.GameObjects.Particles.ParticleEmitter;
  private confettiFx: Phaser.GameObjects.Particles.ParticleEmitter;
  private motesFx: Phaser.GameObjects.Particles.ParticleEmitter;
  private vignette: Phaser.GameObjects.Image;
  private vignetteTween?: Phaser.Tweens.Tween;
  private dangerOn = false;

  constructor(
    private scene: Phaser.Scene,
    w: number,
    h: number,
  ) {
    this.dustFx = scene.add
      .particles(0, 0, 'fx_dot', {
        lifespan: 520,
        speed: { min: 26, max: 96 },
        angle: { min: 200, max: 340 },
        scale: { start: 0.5, end: 0 },
        alpha: { start: 0.5, end: 0 },
        gravityY: 110,
        tint: 0xd8c6a8,
        emitting: false,
      })
      .setDepth(60);

    this.sparkFx = scene.add
      .particles(0, 0, 'fx_chip', {
        lifespan: 420,
        speed: { min: 90, max: 260 },
        scale: { start: 0.9, end: 0 },
        alpha: { start: 1, end: 0 },
        gravityY: 620,
        rotate: { min: -220, max: 220 },
        emitting: false,
      })
      .setDepth(62);

    this.glassFx = scene.add
      .particles(0, 0, 'fx_chip', {
        lifespan: 700,
        speed: { min: 120, max: 340 },
        scale: { start: 0.7, end: 0.1 },
        alpha: { start: 1, end: 0 },
        gravityY: 780,
        rotate: { min: -360, max: 360 },
        tint: [0xc6f4f6, 0x8fdfe3, 0xffffff],
        emitting: false,
      })
      .setDepth(64);

    this.debrisFx = scene.add
      .particles(0, 0, 'fx_chip', {
        lifespan: 900,
        speed: { min: 100, max: 420 },
        scale: { start: 1.5, end: 0.2 },
        alpha: { start: 1, end: 0 },
        gravityY: 900,
        rotate: { min: -520, max: 520 },
        tint: [0x8d5a24, 0x535f73, 0x3d4a5c, 0xcf9048],
        emitting: false,
      })
      .setDepth(66);

    this.confettiFx = scene.add
      .particles(0, 0, 'fx_chip', {
        lifespan: 1900,
        speed: { min: 180, max: 520 },
        angle: { min: 200, max: 340 },
        scale: { start: 1.3, end: 0.5 },
        alpha: { start: 1, end: 0.1 },
        gravityY: 620,
        rotate: { min: -420, max: 420 },
        tint: [0x4da3ff, 0xffc93c, 0x3fd68a, 0xff8f6b, 0xffffff],
        emitting: false,
      })
      .setDepth(200);

    // Slow drifting motes give the warehouse air some life.
    this.motesFx = scene.add
      .particles(0, 0, 'fx_dot', {
        x: { min: 0, max: w },
        y: { min: h * 0.15, max: h * 0.8 },
        lifespan: 6200,
        speedY: { min: -13, max: -3 },
        speedX: { min: -8, max: 8 },
        scale: { start: 0.16, end: 0.03 },
        alpha: { start: 0, end: 0 },
        tint: 0xffd6a0,
        frequency: 420,
        quantity: 1,
      })
      .setDepth(3);
    this.motesFx.setAlpha(0.5);

    this.vignette = scene.add
      .image(w / 2, h / 2, 'fx_vignette')
      .setDisplaySize(w, h)
      .setDepth(150)
      .setAlpha(0);
  }

  dust(x: number, y: number, amount = 8) {
    this.dustFx.emitParticleAt(x, y, amount);
  }

  impact(x: number, y: number, tint: number, amount = 8) {
    this.sparkFx.setParticleTint(tint);
    this.sparkFx.emitParticleAt(x, y, amount);
  }

  glass(x: number, y: number, amount = 22) {
    this.glassFx.emitParticleAt(x, y, amount);
  }

  debris(x: number, y: number, amount = 14) {
    this.debrisFx.emitParticleAt(x, y, amount);
  }

  celebrate(x: number, y: number) {
    this.confettiFx.emitParticleAt(x, y, 46);
    this.scene.time.delayedCall(220, () => this.confettiFx.emitParticleAt(x - 150, y + 30, 26));
    this.scene.time.delayedCall(400, () => this.confettiFx.emitParticleAt(x + 150, y + 30, 26));
  }

  shake(intensity = 0.006, duration = 200) {
    this.scene.cameras.main.shake(duration, intensity, true);
  }

  flash(color = COLORS.bad, duration = 140) {
    const c = Phaser.Display.Color.IntegerToColor(color);
    this.scene.cameras.main.flash(duration, c.red, c.green, c.blue, true);
  }

  /** Red edge-glow while a hazard countdown is running. Safe to poll. */
  setDanger(on: boolean) {
    if (on === this.dangerOn) return;
    this.dangerOn = on;
    this.vignetteTween?.remove();
    if (on) {
      this.vignetteTween = this.scene.tweens.add({
        targets: this.vignette,
        alpha: { from: 0.35, to: 0.85 },
        duration: 420,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else {
      this.vignetteTween = this.scene.tweens.add({
        targets: this.vignette,
        alpha: 0,
        duration: 220,
      });
    }
  }

  destroy() {
    this.vignetteTween?.remove();
    this.motesFx.destroy();
  }
}
