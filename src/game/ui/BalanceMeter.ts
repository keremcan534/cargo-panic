/**
 * The balance readout. Shows the live left/right torque split, a needle for
 * the current lean, and a translucent ghost needle previewing where the drop
 * you are dragging would put you. The preview is what makes the whole system
 * feel predictable rather than punishing.
 */

import Phaser from 'phaser';
import { COLORS, FONT, HEX } from '../config';
import type { BalanceStatus } from '../systems/BalanceSystem';

const BAR_W = 588;
const BAR_H = 26;

export class BalanceMeter extends Phaser.GameObjects.Container {
  private track: Phaser.GameObjects.Graphics;
  private needle: Phaser.GameObjects.Graphics;
  private ghost: Phaser.GameObjects.Graphics;
  private fill: Phaser.GameObjects.Graphics;
  private titleText: Phaser.GameObjects.Text;
  private deltaText: Phaser.GameObjects.Text;
  private leftText: Phaser.GameObjects.Text;
  private rightText: Phaser.GameObjects.Text;
  private pulse?: Phaser.Tweens.Tween;

  private tolerance = 1;
  private displayNet = 0;
  private targetNet = 0;
  private lastStatus: BalanceStatus = 'stable';

  constructor(scene: Phaser.Scene, x: number, y: number, tolerance: number) {
    super(scene, x, y);
    this.tolerance = Math.max(0.001, tolerance);

    this.titleText = scene.add
      .text(-BAR_W / 2, -4, 'RACK BALANCE', {
        fontFamily: FONT,
        fontSize: '19px',
        fontStyle: 'bold',
        color: HEX.textDim,
      })
      .setOrigin(0, 0.5);

    this.deltaText = scene.add
      .text(BAR_W / 2, -4, '', {
        fontFamily: FONT,
        fontSize: '21px',
        fontStyle: 'bold',
        color: HEX.good,
      })
      .setOrigin(1, 0.5);

    this.track = scene.add.graphics();
    this.fill = scene.add.graphics();
    this.ghost = scene.add.graphics();
    this.needle = scene.add.graphics();

    this.leftText = scene.add
      .text(-BAR_W / 2, 46, 'L 0.0', {
        fontFamily: FONT,
        fontSize: '17px',
        color: HEX.textDim,
      })
      .setOrigin(0, 0.5);
    this.rightText = scene.add
      .text(BAR_W / 2, 46, 'R 0.0', {
        fontFamily: FONT,
        fontSize: '17px',
        color: HEX.textDim,
      })
      .setOrigin(1, 0.5);

    this.add([
      this.titleText,
      this.deltaText,
      this.track,
      this.fill,
      this.ghost,
      this.needle,
      this.leftText,
      this.rightText,
    ]);

    this.drawTrack();
    this.drawNeedle();
    scene.add.existing(this);
  }

  /** Full-scale torque the bar spans in each direction. */
  private get range() {
    return this.tolerance * 1.6;
  }

  private xFor(net: number) {
    const clamped = Phaser.Math.Clamp(net / this.range, -1, 1);
    return (clamped * (BAR_W - 24)) / 2;
  }

  private drawTrack() {
    const g = this.track;
    const top = 16;
    g.clear();

    g.fillStyle(0x0a0e14, 0.9);
    g.fillRoundedRect(-BAR_W / 2 - 4, top - 4, BAR_W + 8, BAR_H + 8, 9);

    const half = BAR_W / 2;
    const safe = (0.5 / 1.6) * half;
    const risk = (1 / 1.6) * half;

    g.fillStyle(COLORS.bad, 0.55);
    g.fillRoundedRect(-half, top, BAR_W, BAR_H, 6);
    g.fillStyle(COLORS.warn, 0.55);
    g.fillRect(-risk, top, risk * 2, BAR_H);
    g.fillStyle(COLORS.good, 0.5);
    g.fillRoundedRect(-safe, top, safe * 2, BAR_H, 4);

    // Threshold ticks so the red line is a place, not a surprise.
    g.lineStyle(2, 0x0a0e14, 0.85);
    for (const t of [-risk, risk]) {
      g.beginPath();
      g.moveTo(t, top);
      g.lineTo(t, top + BAR_H);
      g.strokePath();
    }
    g.lineStyle(3, 0xffffff, 0.75);
    g.beginPath();
    g.moveTo(0, top - 3);
    g.lineTo(0, top + BAR_H + 3);
    g.strokePath();

    g.lineStyle(2, COLORS.panelEdge, 1);
    g.strokeRoundedRect(-half - 4, top - 4, BAR_W + 8, BAR_H + 8, 9);
  }

  private drawNeedle() {
    const g = this.needle;
    const top = 16;
    g.clear();
    g.fillStyle(0x000000, 0.5);
    g.fillTriangle(-11, top - 20, 11, top - 20, 1, top - 2);
    g.fillStyle(COLORS.text, 1);
    g.fillTriangle(-11, top - 22, 11, top - 22, 0, top - 4);
    g.fillStyle(COLORS.text, 1);
    g.fillRect(-2, top - 2, 4, BAR_H + 4);
  }

  /** Ghost needle showing the result of the drop currently being dragged. */
  showPreview(net: number) {
    const g = this.ghost;
    const top = 16;
    g.clear();
    const x = this.xFor(net);
    g.fillStyle(COLORS.accentWarm, 0.85);
    g.fillTriangle(x - 9, top - 20, x + 9, top - 20, x, top - 5);
    g.fillStyle(COLORS.accentWarm, 0.5);
    g.fillRect(x - 1.5, top - 4, 3, BAR_H + 4);
    g.setVisible(true);
  }

  hidePreview() {
    this.ghost.clear();
  }

  setValue(net: number, leftTorque: number, rightTorque: number, status: BalanceStatus) {
    this.targetNet = net;

    const imbalance = Math.abs(net);
    const color = status === 'stable' ? HEX.good : status === 'risky' ? HEX.warn : HEX.bad;
    this.deltaText.setText(`${imbalance.toFixed(1)} / ${this.tolerance.toFixed(1)}`);
    this.deltaText.setColor(color);
    this.leftText.setText(`LEFT ${leftTorque.toFixed(1)}`);
    this.rightText.setText(`${rightTorque.toFixed(1)} RIGHT`);
    this.leftText.setColor(net < -0.05 ? HEX.text : HEX.textDim);
    this.rightText.setColor(net > 0.05 ? HEX.text : HEX.textDim);

    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.pulse?.remove();
      this.pulse = undefined;
      this.deltaText.setScale(1);
      if (status === 'danger') {
        this.pulse = this.scene.tweens.add({
          targets: this.deltaText,
          scale: 1.16,
          duration: 260,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }
  }

  /** Smoothly chases the target so the needle swings instead of snapping. */
  tick(deltaMs: number) {
    const k = 1 - Math.pow(0.001, deltaMs / 1000);
    this.displayNet += (this.targetNet - this.displayNet) * k;
    if (Math.abs(this.targetNet - this.displayNet) < 0.002) this.displayNet = this.targetNet;
    this.needle.x = this.xFor(this.displayNet);

    const g = this.fill;
    const top = 16;
    g.clear();
    const x = this.xFor(this.displayNet);
    const status = this.lastStatus;
    const c = status === 'stable' ? COLORS.good : status === 'risky' ? COLORS.warn : COLORS.bad;
    if (Math.abs(x) > 1) {
      g.fillStyle(c, 0.85);
      const w = Math.abs(x);
      g.fillRect(Math.min(0, x), top + 4, w, BAR_H - 8);
    }
  }

  override destroy(fromScene?: boolean) {
    this.pulse?.remove();
    super.destroy(fromScene);
  }
}
