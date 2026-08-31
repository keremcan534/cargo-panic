/**
 * A single piece of cargo. Owns its container so it can be re-parented between
 * scene space (on the belt / in hand) and the rack container (once placed), and
 * inherit the rack's tilt for free while it is stowed.
 */

import Phaser from 'phaser';
import { COLORS, PKG_H } from '../config';
import { PACKAGE_SPECS } from '../levels/types';
import type { PackageSpec, PackageType } from '../levels/types';
import { pkgTextureKey, pkgWidth } from '../textures';

export type PackageState = 'queued' | 'dragging' | 'placed' | 'falling';

export class CargoPackage {
  readonly id: number;
  readonly type: PackageType;
  readonly spec: PackageSpec;
  readonly view: Phaser.GameObjects.Container;
  readonly width: number;

  state: PackageState = 'queued';
  /** Tier the package is resting on, or -1. */
  shelf = -1;
  /** First occupied slot, or -1. */
  slot = -1;

  private body: Phaser.GameObjects.Image;
  private shadow: Phaser.GameObjects.Image;
  private cracks?: Phaser.GameObjects.Image;
  private ring: Phaser.GameObjects.Graphics;
  private ringTween?: Phaser.Tweens.Tween;
  private crackTween?: Phaser.Tweens.Tween;

  constructor(
    private scene: Phaser.Scene,
    id: number,
    type: PackageType,
  ) {
    this.id = id;
    this.type = type;
    this.spec = PACKAGE_SPECS[type];
    this.width = pkgWidth(this.spec.slots);

    this.shadow = scene.add
      .image(0, PKG_H / 2 + 4, 'fx_shadow')
      .setDisplaySize(this.width * 1.06, 26)
      .setAlpha(0.4);

    this.body = scene.add.image(0, 0, pkgTextureKey(type)).setOrigin(0.5);

    this.ring = scene.add.graphics();
    this.ring.setVisible(false);

    this.view = scene.add.container(0, 0, [this.shadow, this.body, this.ring]);
    this.view.setSize(this.width, PKG_H);

    if (type === 'fragile') {
      this.cracks = scene.add.image(0, 0, 'fx_cracks').setOrigin(0.5).setAlpha(0);
      this.view.add(this.cracks);
    }
  }

  get weight() {
    return this.spec.weight;
  }

  get slots() {
    return this.spec.slots;
  }

  /** Half-extents of the touch target, padded out for narrow one-slot boxes. */
  get grabHalfW() {
    return Math.max(this.width, 86) / 2;
  }

  get grabHalfH() {
    return (PKG_H + 24) / 2;
  }

  /**
   * `restScale` is the scale the package will have once it is stowed, so a
   * lifted box is already the size of the hole it is going into.
   */
  setDragging(on: boolean, restScale = 1) {
    this.scene.tweens.killTweensOf(this.body);
    if (on) {
      this.state = 'dragging';
      this.scene.tweens.add({
        targets: this.view,
        scale: restScale * 1.07,
        duration: 120,
        ease: 'Back.easeOut',
      });
      this.shadow.setAlpha(0.55).setDisplaySize(this.width * 1.15, 30);
      this.shadow.y = PKG_H / 2 + 20;
    } else {
      this.scene.tweens.add({ targets: this.view, scale: 1, duration: 110, ease: 'Sine.easeOut' });
      this.shadow.setAlpha(0.4).setDisplaySize(this.width * 1.06, 26);
      this.shadow.y = PKG_H / 2 + 4;
    }
  }

  /** Squash-and-stretch on touchdown. Heavier cargo squashes harder. */
  landBounce(strength = 1) {
    this.scene.tweens.killTweensOf(this.body);
    this.body.setScale(1);
    const squash = Math.min(0.3, 0.1 + strength * 0.035);
    this.scene.tweens.chain({
      targets: this.body,
      tweens: [
        { scaleX: 1 + squash, scaleY: 1 - squash, duration: 80, ease: 'Quad.easeOut' },
        { scaleX: 1 - squash * 0.4, scaleY: 1 + squash * 0.4, duration: 90, ease: 'Quad.easeInOut' },
        { scaleX: 1, scaleY: 1, duration: 130, ease: 'Back.easeOut' },
      ],
    });
  }

  /** Fragile cargo under load: cracks fade in and the box judders. */
  setCracking(on: boolean) {
    if (!this.cracks) return;
    if (on === !!this.crackTween) return;
    if (on) {
      this.crackTween = this.scene.tweens.add({
        targets: this.cracks,
        alpha: { from: 0.15, to: 0.95 },
        duration: 320,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.scene.tweens.add({
        targets: this.body,
        angle: { from: -1.6, to: 1.6 },
        duration: 70,
        yoyo: true,
        repeat: -1,
      });
    } else {
      this.crackTween?.remove();
      this.crackTween = undefined;
      this.scene.tweens.killTweensOf(this.body);
      this.cracks.setAlpha(0);
      this.body.setAngle(0);
    }
  }

  /** Gold outline used by the hint system. */
  setHinted(on: boolean) {
    this.ringTween?.remove();
    this.ringTween = undefined;
    if (!on) {
      this.ring.setVisible(false);
      return;
    }
    const g = this.ring;
    g.clear();
    g.lineStyle(4, COLORS.gold, 1);
    g.strokeRoundedRect(-this.width / 2 - 4, -PKG_H / 2 - 4, this.width + 8, PKG_H + 8, 9);
    g.setVisible(true).setAlpha(1);
    this.ringTween = this.scene.tweens.add({
      targets: g,
      alpha: 0.25,
      duration: 420,
      yoyo: true,
      repeat: -1,
    });
  }

  setDepth(d: number) {
    this.view.setDepth(d);
    return this;
  }

  destroy() {
    this.ringTween?.remove();
    this.crackTween?.remove();
    this.scene.tweens.killTweensOf(this.body);
    this.scene.tweens.killTweensOf(this.view);
    this.view.destroy();
  }
}
