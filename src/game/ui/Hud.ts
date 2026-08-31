/**
 * Gameplay HUD: level identity, objective, remaining cargo, the pause/restart
 * controls, transient toasts, and the hazard banner that counts down the grace
 * period before a level fails.
 */

import Phaser from 'phaser';
import { COLORS, FONT, HEX } from '../config';
import type { Layout } from '../layout';
import { IconButton } from './Button';
import type { HazardKind } from '../systems/HazardSystem';

const HAZARD_TEXT: Record<HazardKind, string> = {
  balance: 'RACK TIPPING',
  overload: 'SHELF OVERLOADED',
  fragile: 'FRAGILE CARGO CRUSHING',
};

export interface HudConfig {
  /** Big line: "LEVEL 7" or "WAVE 12". */
  title: string;
  /** Second line: the level name, or the live score in Endless. */
  subtitle: string;
  subtitleColor?: string;
  objective: string;
  /** Endless hides it - a stray tap should never wipe a run. */
  showRestart: boolean;
}

export class Hud {
  private titleText: Phaser.GameObjects.Text;
  private subtitleText: Phaser.GameObjects.Text;
  private objectiveText: Phaser.GameObjects.Text;
  private remainingText: Phaser.GameObjects.Text;
  private remainingPill: Phaser.GameObjects.Graphics;

  private banner: Phaser.GameObjects.Container;
  private bannerBg: Phaser.GameObjects.Graphics;
  private bannerText: Phaser.GameObjects.Text;
  private bannerBar: Phaser.GameObjects.Graphics;
  private bannerVisible = false;
  private bannerTween?: Phaser.Tweens.Tween;

  private toastPool: Phaser.GameObjects.Container[] = [];

  constructor(
    private scene: Phaser.Scene,
    private layout: Layout,
    config: HudConfig,
    handlers: { onRestart: () => void; onPause: () => void },
  ) {
    const top = layout.hudTop;

    const bg = scene.add.graphics();
    bg.fillStyle(0x0b1017, 0.55);
    bg.fillRoundedRect(14, top - 4, layout.w - 28, layout.hudH + 8, 16);
    bg.lineStyle(2, COLORS.panelEdge, 0.8);
    bg.strokeRoundedRect(14, top - 4, layout.w - 28, layout.hudH + 8, 16);

    this.titleText = scene.add
      .text(30, top + 26, config.title, {
        fontFamily: FONT,
        fontSize: '27px',
        fontStyle: 'bold',
        color: HEX.text,
      })
      .setOrigin(0, 0.5);

    this.subtitleText = scene.add
      .text(30, top + 55, config.subtitle, {
        fontFamily: FONT,
        fontSize: '19px',
        fontStyle: 'bold',
        color: config.subtitleColor ?? HEX.accentWarm,
      })
      .setOrigin(0, 0.5);

    this.objectiveText = scene.add
      .text(30, top + 79, config.objective, {
        fontFamily: FONT,
        fontSize: '17px',
        color: HEX.textDim,
        wordWrap: { width: 460 },
      })
      .setOrigin(0, 0.5);

    new IconButton(scene, layout.w - 50, top + 30, 46, 'pause', handlers.onPause);
    if (config.showRestart) {
      new IconButton(scene, layout.w - 112, top + 30, 46, 'restart', handlers.onRestart);
    }

    this.remainingPill = scene.add.graphics();
    this.remainingText = scene.add
      .text(layout.w - 34, top + 76, '', {
        fontFamily: FONT,
        fontSize: '18px',
        fontStyle: 'bold',
        color: HEX.text,
      })
      .setOrigin(1, 0.5);

    // --- hazard banner ------------------------------------------------------
    const by = layout.meterY + layout.meterH + 40;
    this.bannerBg = scene.add.graphics();
    this.bannerText = scene.add
      .text(0, -6, '', {
        fontFamily: FONT,
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#2a0503',
      })
      .setOrigin(0.5);
    this.bannerBar = scene.add.graphics();
    this.banner = scene.add
      .container(layout.w / 2, by, [this.bannerBg, this.bannerText, this.bannerBar])
      .setDepth(95)
      .setAlpha(0)
      .setVisible(false);
  }

  setRemaining(left: number, total: number) {
    this.remainingText.setText(`${left} / ${total} LEFT`);
    const w = this.remainingText.width + 26;
    const g = this.remainingPill;
    g.clear();
    g.fillStyle(left === 0 ? COLORS.good : COLORS.panelEdge, left === 0 ? 0.9 : 1);
    g.fillRoundedRect(this.layout.w - 34 - w + 13, this.layout.hudTop + 62, w, 28, 14);
    this.remainingText.setColor(left === 0 ? '#06210f' : HEX.text);
  }

  setObjective(text: string) {
    this.objectiveText.setText(text);
  }

  setTitle(text: string) {
    this.titleText.setText(text);
  }

  setSubtitle(text: string, color?: string) {
    this.subtitleText.setText(text);
    if (color) this.subtitleText.setColor(color);
  }

  /** Quick pop on the subtitle, used when the Endless score jumps. */
  pulseSubtitle() {
    this.scene.tweens.killTweensOf(this.subtitleText);
    this.subtitleText.setScale(1);
    this.scene.tweens.add({
      targets: this.subtitleText,
      scale: 1.18,
      duration: 130,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  // --- hazard banner --------------------------------------------------------

  showHazard(kind: HazardKind, remainingMs: number, totalMs: number) {
    const w = 560;
    const h = 54;
    if (!this.bannerVisible) {
      this.bannerVisible = true;
      this.banner.setVisible(true);
      this.bannerTween?.remove();
      this.bannerTween = this.scene.tweens.add({
        targets: this.banner,
        alpha: 1,
        scaleX: { from: 0.85, to: 1 },
        scaleY: { from: 0.85, to: 1 },
        duration: 160,
        ease: 'Back.easeOut',
      });
    }

    const g = this.bannerBg;
    g.clear();
    g.fillStyle(0x000000, 0.45);
    g.fillRoundedRect(-w / 2, -h / 2 + 5, w, h, 14);
    g.fillStyle(COLORS.bad, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
    g.fillStyle(0xffffff, 0.16);
    g.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h / 2, 12);

    const secs = Math.max(0, remainingMs / 1000);
    this.bannerText.setText(`${HAZARD_TEXT[kind]}  -  FIX IT  ${secs.toFixed(1)}s`);

    const bar = this.bannerBar;
    const bw = w - 32;
    const ratio = Phaser.Math.Clamp(remainingMs / totalMs, 0, 1);
    bar.clear();
    bar.fillStyle(0x2a0503, 0.45);
    bar.fillRoundedRect(-bw / 2, h / 2 - 15, bw, 8, 4);
    bar.fillStyle(0xffffff, 0.92);
    bar.fillRoundedRect(-bw / 2, h / 2 - 15, bw * ratio, 8, 4);
  }

  hideHazard() {
    if (!this.bannerVisible) return;
    this.bannerVisible = false;
    this.bannerTween?.remove();
    this.bannerTween = this.scene.tweens.add({
      targets: this.banner,
      alpha: 0,
      duration: 180,
      onComplete: () => this.banner.setVisible(false),
    });
  }

  // --- toasts ---------------------------------------------------------------

  /** Short message that floats up and fades over the play area. */
  toast(message: string, tone: 'bad' | 'good' | 'info' = 'bad') {
    const y = this.layout.conveyorY - 132;
    const color = tone === 'good' ? COLORS.good : tone === 'info' ? COLORS.accent : COLORS.bad;
    const ink = tone === 'bad' ? '#2a0503' : tone === 'good' ? '#06210f' : '#04121f';

    const text = this.scene.add
      .text(0, 0, message, {
        fontFamily: FONT,
        fontSize: '23px',
        fontStyle: 'bold',
        color: ink,
      })
      .setOrigin(0.5);
    const w = text.width + 44;
    const g = this.scene.add.graphics();
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(-w / 2, -20 + 4, w, 44, 22);
    g.fillStyle(color, 1);
    g.fillRoundedRect(-w / 2, -20, w, 44, 22);

    const c = this.scene.add.container(this.layout.w / 2, y, [g, text]).setDepth(120);
    this.toastPool.push(c);
    if (this.toastPool.length > 3) this.toastPool.shift()?.destroy();

    c.setScale(0.7);
    this.scene.tweens.add({
      targets: c,
      scale: 1,
      duration: 150,
      ease: 'Back.easeOut',
    });
    this.scene.tweens.add({
      targets: c,
      y: y - 54,
      alpha: 0,
      delay: 620,
      duration: 380,
      ease: 'Quad.easeIn',
      onComplete: () => {
        const i = this.toastPool.indexOf(c);
        if (i >= 0) this.toastPool.splice(i, 1);
        c.destroy();
      },
    });
  }

  destroy() {
    this.bannerTween?.remove();
    for (const t of this.toastPool) t.destroy();
    this.toastPool.length = 0;
  }
}
