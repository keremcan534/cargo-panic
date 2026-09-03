/**
 * Modal overlays: pause, level cleared, and level failed. All three share one
 * card shell so they animate and dismiss identically.
 */

import Phaser from 'phaser';
import { COLORS, FONT, HEX } from '../config';
import type { Layout } from '../layout';
import { PACKAGE_SPECS } from '../levels/types';
import type { PackageType } from '../levels/types';
import { audio } from '../systems/AudioManager';
import { formatScore, formatSeed } from '../systems/RunManager';
import type { WaveResult } from '../systems/RunManager';
import { pkgTextureKey, TEX_SCALE } from '../textures';
import { Button } from './Button';
import { registerTap, TAP_LAYER, unregisterTap } from './TapManager';
import type { Tappable } from './TapManager';

export class Modal extends Phaser.GameObjects.Container implements Tappable {
  /** Swallows every tap aimed at the screen behind the card. */
  readonly tapLayer = TAP_LAYER.modalBlocker;
  readonly tapBlocking = true;

  protected card: Phaser.GameObjects.Container;
  private dim: Phaser.GameObjects.Rectangle;
  private closing = false;

  constructor(
    scene: Phaser.Scene,
    protected layout: Layout,
    cardW: number,
    cardH: number,
  ) {
    super(scene, 0, 0);
    this.setDepth(500);

    this.dim = scene.add.rectangle(0, 0, layout.w, layout.h, 0x05080d, 0.82).setOrigin(0);

    const g = scene.add.graphics();
    g.fillStyle(0x000000, 0.5);
    g.fillRoundedRect(-cardW / 2, -cardH / 2 + 10, cardW, cardH, 26);
    g.fillStyle(COLORS.panel, 1);
    g.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 26);
    g.lineStyle(2, COLORS.panelEdge, 1);
    g.strokeRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 26);
    g.fillStyle(0xffffff, 0.04);
    g.fillRoundedRect(-cardW / 2 + 4, -cardH / 2 + 4, cardW - 8, cardH * 0.42, 22);

    this.card = scene.add.container(layout.w / 2, layout.h / 2, [g]);

    this.add([this.dim, this.card]);
    registerTap(scene, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => unregisterTap(scene, this));
    scene.add.existing(this);

    this.card.setScale(0.82);
    this.card.setAlpha(0);
    this.dim.setAlpha(0);
    scene.tweens.add({ targets: this.dim, alpha: 0.82, duration: 180 });
    scene.tweens.add({
      targets: this.card,
      scale: 1,
      alpha: 1,
      duration: 300,
      ease: 'Back.easeOut',
    });
  }

  tapEnabled() {
    return !this.closing;
  }

  tapHitTest(x: number, y: number) {
    return x >= 0 && y >= 0 && x <= this.layout.w && y <= this.layout.h && !this.closing;
  }

  tapPress() {
    /* a blocker never renders a pressed state */
  }

  tapActivate() {
    /* and never does anything */
  }

  /** Convenience for subclasses: a button that sits above this modal's dim. */
  protected modalButton(opts: Omit<ConstructorParameters<typeof Button>[1], 'layer'>) {
    const b = new Button(this.scene, { ...opts, layer: TAP_LAYER.modal });
    this.addToCard(b);
    return b;
  }

  protected addToCard(...items: Phaser.GameObjects.GameObject[]) {
    this.card.add(items);
  }

  close(after?: () => void) {
    if (this.closing) return;
    this.closing = true;
    unregisterTap(this.scene, this);
    this.scene.tweens.add({
      targets: this.card,
      scale: 0.86,
      alpha: 0,
      duration: 160,
      ease: 'Quad.easeIn',
    });
    this.scene.tweens.add({
      targets: this.dim,
      alpha: 0,
      duration: 180,
      onComplete: () => {
        this.destroy();
        after?.();
      },
    });
  }

  protected label(text: string, y: number, size: number, color: string, bold = true) {
    const t = this.scene.add
      .text(0, y, text, {
        fontFamily: FONT,
        fontSize: `${size}px`,
        fontStyle: bold ? 'bold' : 'normal',
        color,
        align: 'center',
        wordWrap: { width: 500 },
      })
      .setOrigin(0.5);
    this.card.add(t);
    return t;
  }

  /** A label/value row, used for the result stats. */
  protected statRow(y: number, key: string, value: string, valueColor: string = HEX.text) {
    const w = 470;
    const g = this.scene.add.graphics();
    g.fillStyle(0x0d1420, 0.85);
    g.fillRoundedRect(-w / 2, y - 22, w, 44, 12);

    const k = this.scene.add
      .text(-w / 2 + 18, y, key, {
        fontFamily: FONT,
        fontSize: '19px',
        color: HEX.textDim,
      })
      .setOrigin(0, 0.5);
    const v = this.scene.add
      .text(w / 2 - 18, y, value, {
        fontFamily: FONT,
        fontSize: '21px',
        fontStyle: 'bold',
        color: valueColor,
      })
      .setOrigin(1, 0.5);
    this.card.add([g, k, v]);
  }
}

export interface WinInfo {
  levelId: number;
  levelName: string;
  stars: number;
  imbalance: number;
  tolerance: number;
  packages: number;
  mistakes: number;
  hintUsed: boolean;
  isLastLevel: boolean;
  /** Beat a previously recorded balance on this level. */
  newBest: boolean;
  /** First time this level has ever been cleared. */
  firstClear: boolean;
}

export class WinPanel extends Modal {
  constructor(
    scene: Phaser.Scene,
    layout: Layout,
    info: WinInfo,
    actions: { onNext: () => void; onRetry: () => void; onLevels: () => void },
  ) {
    super(scene, layout, 604, 690);

    this.label('WAREHOUSE', -282, 26, HEX.textDim);
    this.label('SECURED', -240, 46, HEX.good);

    // Stars pop in one at a time with a rising chime.
    const gap = 104;
    for (let i = 0; i < 3; i++) {
      const earned = i < info.stars;
      const base = 1 / TEX_SCALE;
      const s = scene.add
        .image((i - 1) * gap, -152, earned ? 'star_on' : 'star_off')
        .setScale(earned ? 0 : base)
        .setAlpha(earned ? 1 : 0.55);
      this.addToCard(s);
      if (earned) {
        scene.time.delayedCall(260 + i * 220, () => {
          if (!s.scene) return;
          audio.star(i);
          scene.tweens.add({
            targets: s,
            scale: { from: 0, to: base * 1.15 },
            angle: { from: -50, to: 0 },
            duration: 300,
            ease: 'Back.easeOut',
            onComplete: () => {
              scene.tweens.add({ targets: s, scale: base, duration: 140 });
            },
          });
        });
      }
    }

    const accuracy = Math.max(
      0,
      Math.round((1 - info.imbalance / Math.max(info.tolerance, 0.001)) * 100),
    );
    const accColor = accuracy >= 80 ? HEX.good : accuracy >= 55 ? HEX.warn : HEX.text;

    this.statRow(-62, 'BALANCE ACCURACY', `${accuracy}%`, accColor);
    this.statRow(-8, 'FINAL IMBALANCE', info.imbalance.toFixed(2), accColor);
    this.statRow(46, 'PACKAGES STOWED', `${info.packages} / ${info.packages}`, HEX.good);
    this.statRow(
      100,
      'REJECTED DROPS',
      String(info.mistakes),
      info.mistakes === 0 ? HEX.good : HEX.warn,
    );

    if (info.newBest) {
      this.label('NEW PERSONAL BEST', 140, 19, HEX.gold);
    } else if (info.hintUsed) {
      this.label('HINT USED - MAX 2 STARS', 140, 18, HEX.textDim, false);
    } else if (info.firstClear && !info.isLastLevel) {
      this.label(`LEVEL ${info.levelId + 1} UNLOCKED`, 140, 19, HEX.accent);
    }

    if (info.isLastLevel) {
      this.label('ALL 25 LEVELS CLEARED', 178, 21, HEX.accentWarm);
    }

    const by = 226;
    this.modalButton({
      x: 0,
      y: by,
      width: 480,
      height: 74,
      label: info.isLastLevel ? 'LEVEL SELECT' : 'NEXT LEVEL',
      style: 'primary',
      onClick: () => this.close(info.isLastLevel ? actions.onLevels : actions.onNext),
    });

    this.modalButton({
      x: -122,
      y: by + 88,
      width: 232,
      height: 64,
      label: 'RETRY',
      style: 'secondary',
      fontSize: 26,
      onClick: () => this.close(actions.onRetry),
    });
    this.modalButton({
      x: 122,
      y: by + 88,
      width: 232,
      height: 64,
      label: 'LEVELS',
      style: 'secondary',
      fontSize: 26,
      onClick: () => this.close(actions.onLevels),
    });
  }
}

export type FailReason = 'collapse' | 'overload' | 'fragile';

const FAIL_COPY: Record<FailReason, { title: string; body: string }> = {
  collapse: {
    title: 'RACK COLLAPSED',
    body: 'Left and right torque drifted too far apart. Spread the weight evenly - and remember the upper tiers count for more.',
  },
  overload: {
    title: 'SHELF OVERLOADED',
    body: 'A shelf held more weight than its load rating. Watch the bar under each plank and move cargo down a tier.',
  },
  fragile: {
    title: 'FRAGILE CARGO DAMAGED',
    body: 'Heavy cargo sat in the column directly above a fragile crate. Keep those marked columns clear.',
  },
};

export class FailPanel extends Modal {
  constructor(
    scene: Phaser.Scene,
    layout: Layout,
    reason: FailReason,
    detail: string,
    actions: { onRetry: () => void; onLevels: () => void },
  ) {
    super(scene, layout, 604, 470);
    const copy = FAIL_COPY[reason];

    this.label('SHIPMENT LOST', -172, 24, HEX.textDim);
    this.label(copy.title, -126, 40, HEX.bad);
    this.label(copy.body, -40, 20, HEX.textDim, false);
    if (detail) this.label(detail, 42, 20, HEX.warn);

    this.modalButton({
      x: 0,
      y: 116,
      width: 480,
      height: 76,
      label: 'RETRY',
      style: 'primary',
      onClick: () => this.close(actions.onRetry),
    });
    this.modalButton({
      x: 0,
      y: 190,
      width: 300,
      height: 56,
      label: 'LEVEL SELECT',
      style: 'ghost',
      fontSize: 24,
      onClick: () => this.close(actions.onLevels),
    });
  }
}

export class PausePanel extends Modal {
  constructor(
    scene: Phaser.Scene,
    layout: Layout,
    actions: {
      onResume: () => void;
      onRestart: () => void;
      onLevels: () => void;
      onToggleSound: () => boolean;
      onToggleHaptics: () => boolean;
      soundOn: boolean;
      hapticsOn: boolean;
      /** Endless renames these - there is no level to restart. */
      restartLabel?: string;
      exitLabel?: string;
    },
  ) {
    super(scene, layout, 560, 560);

    this.label('PAUSED', -206, 44, HEX.text);

    const soundBtn = this.modalButton({
      x: 0,
      y: -128,
      width: 420,
      height: 62,
      label: actions.soundOn ? 'SOUND: ON' : 'SOUND: OFF',
      style: actions.soundOn ? 'secondary' : 'ghost',
      fontSize: 25,
      onClick: () => {
        const on = actions.onToggleSound();
        soundBtn.setLabel(on ? 'SOUND: ON' : 'SOUND: OFF').setStyleName(on ? 'secondary' : 'ghost');
      },
    });

    const hapticBtn = this.modalButton({
      x: 0,
      y: -52,
      width: 420,
      height: 62,
      label: actions.hapticsOn ? 'VIBRATION: ON' : 'VIBRATION: OFF',
      style: actions.hapticsOn ? 'secondary' : 'ghost',
      fontSize: 25,
      onClick: () => {
        const on = actions.onToggleHaptics();
        hapticBtn
          .setLabel(on ? 'VIBRATION: ON' : 'VIBRATION: OFF')
          .setStyleName(on ? 'secondary' : 'ghost');
      },
    });

    this.modalButton({
      x: 0,
      y: 46,
      width: 420,
      height: 76,
      label: 'RESUME',
      style: 'primary',
      onClick: () => this.close(actions.onResume),
    });
    this.modalButton({
      x: 0,
      y: 132,
      width: 420,
      height: 64,
      label: actions.restartLabel ?? 'RESTART LEVEL',
      style: 'secondary',
      fontSize: 25,
      onClick: () => this.close(actions.onRestart),
    });
    this.modalButton({
      x: 0,
      y: 210,
      width: 420,
      height: 64,
      label: actions.exitLabel ?? 'LEVEL SELECT',
      style: 'ghost',
      fontSize: 25,
      onClick: () => this.close(actions.onLevels),
    });
  }
}

/**
 * The in-game cargo guide. Every rule that can fail a level is written down
 * here, so nothing about the simulation is ever hidden from the player.
 */
export class LegendPanel extends Modal {
  constructor(scene: Phaser.Scene, layout: Layout, onClose: () => void) {
    super(scene, layout, 620, 860);

    this.label('CARGO GUIDE', -382, 36, HEX.text);

    const rows: [PackageType, string][] = [
      ['standard', 'Ordinary carton.'],
      ['heavy', 'Crushes fragile cargo below it.'],
      ['fragile', 'Keep the column above it clear.'],
      ['long', 'Eats three slots.'],
      ['priority', 'Must finish inside a gold zone.'],
    ];

    rows.forEach(([type, note], i) => {
      const y = -318 + i * 78;
      const spec = PACKAGE_SPECS[type];
      // Right-aligned icons keep the text column straight despite the long
      // package being three times as wide as the rest.
      const img = scene.add
        .image(-196, y, pkgTextureKey(type))
        .setOrigin(1, 0.5)
        .setScale((type === 'long' ? 0.36 : 0.7) / TEX_SCALE);
      const name = scene.add
        .text(-172, y - 13, `${spec.label}   WEIGHT ${spec.weight}`, {
          fontFamily: FONT,
          fontSize: '20px',
          fontStyle: 'bold',
          color: HEX.text,
        })
        .setOrigin(0, 0.5);
      const desc = scene.add
        .text(-172, y + 13, note, {
          fontFamily: FONT,
          fontSize: '18px',
          color: HEX.textDim,
        })
        .setOrigin(0, 0.5);
      this.addToCard(img, name, desc);
    });

    const rule = scene.add.graphics();
    rule.lineStyle(2, COLORS.panelEdge, 1);
    rule.beginPath();
    rule.moveTo(-262, 96);
    rule.lineTo(262, 96);
    rule.strokePath();
    this.addToCard(rule);

    this.label('BALANCE', 128, 22, HEX.accent);
    this.label(
      'Torque = weight x distance from the middle x the tier multiplier ' +
        'shown under each shelf. Higher shelves push harder.',
      184,
      18,
      HEX.textDim,
      false,
    );

    this.label('WHEN THE RACK GOES RED', 250, 22, HEX.bad);
    this.label(
      'Too much imbalance, an overloaded shelf, or a crushed fragile crate ' +
        'gives you a few seconds to fix it before the level fails.',
      306,
      18,
      HEX.textDim,
      false,
    );

    this.modalButton({
      x: 0,
      y: 382,
      width: 420,
      height: 68,
      label: 'GOT IT',
      style: 'primary',
      onClick: () => this.close(onClose),
    });
  }
}

/**
 * Non-blocking wave-clear card for Endless mode. Shows the score breakdown,
 * then gets out of the way on its own so a run keeps its rhythm.
 */
export class WaveClearCard extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, layout: Layout, wave: number, result: WaveResult) {
    super(scene, layout.w / 2, layout.h * 0.42);
    this.setDepth(300);

    const w = 460;
    const rows = result.lines.length;
    const h = 128 + rows * 34;

    const g = scene.add.graphics();
    g.fillStyle(0x000000, 0.5);
    g.fillRoundedRect(-w / 2, -h / 2 + 8, w, h, 20);
    g.fillStyle(COLORS.panel, 0.97);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 20);
    g.lineStyle(3, COLORS.good, 0.9);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 20);
    this.add(g);

    const title = scene.add
      .text(0, -h / 2 + 34, 'SHIPMENT DISPATCHED', {
        fontFamily: FONT,
        fontSize: '25px',
        fontStyle: 'bold',
        color: HEX.good,
      })
      .setOrigin(0.5);
    this.add(title);

    result.lines.forEach((line, i) => {
      const y = -h / 2 + 76 + i * 34;
      const key = scene.add
        .text(-w / 2 + 28, y, line.label, {
          fontFamily: FONT,
          fontSize: '19px',
          color: HEX.textDim,
        })
        .setOrigin(0, 0.5);
      const val = scene.add
        .text(w / 2 - 28, y, `+${line.value}`, {
          fontFamily: FONT,
          fontSize: '20px',
          fontStyle: 'bold',
          color: HEX.text,
        })
        .setOrigin(1, 0.5);
      this.add([key, val]);

      // Rows tick in one after another so the total feels earned.
      key.setAlpha(0);
      val.setAlpha(0);
      scene.tweens.add({ targets: [key, val], alpha: 1, duration: 140, delay: 120 + i * 90 });
    });

    const totalY = h / 2 - 32;
    const rule = scene.add.graphics();
    rule.lineStyle(2, COLORS.panelEdge, 1);
    rule.beginPath();
    rule.moveTo(-w / 2 + 26, totalY - 26);
    rule.lineTo(w / 2 - 26, totalY - 26);
    rule.strokePath();
    this.add(rule);

    const total = scene.add
      .text(0, totalY, `+${result.total}`, {
        fontFamily: FONT,
        fontSize: '34px',
        fontStyle: 'bold',
        color: HEX.gold,
      })
      .setOrigin(0.5);
    this.add(total);
    total.setScale(0);
    scene.tweens.add({
      targets: total,
      scale: 1,
      duration: 260,
      delay: 160 + rows * 90,
      ease: 'Back.easeOut',
    });

    void wave;
    this.setScale(0.85).setAlpha(0);
    scene.tweens.add({ targets: this, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
    scene.add.existing(this);
  }

  dismiss() {
    this.scene.tweens.add({
      targets: this,
      y: this.y - 40,
      alpha: 0,
      duration: 220,
      ease: 'Quad.easeIn',
      onComplete: () => this.destroy(),
    });
  }
}

export interface RunOverInfo {
  seed: number;
  wave: number;
  score: number;
  stowed: number;
  cleanWaves: number;
  bestScore: number;
  bestWave: number;
  newBest: boolean;
  reason: FailReason;
}

export class RunOverPanel extends Modal {
  constructor(
    scene: Phaser.Scene,
    layout: Layout,
    info: RunOverInfo,
    actions: { onRetry: () => void; onMenu: () => void },
  ) {
    super(scene, layout, 604, 690);
    const copy = FAIL_COPY[info.reason];

    this.label('RUN OVER', -278, 26, HEX.textDim);
    this.label(copy.title, -234, 36, HEX.bad);

    this.label(formatScore(info.score), -164, 62, HEX.gold);
    this.label('FINAL SCORE', -120, 18, HEX.textDim, false);

    this.statRow(-56, 'WAVES CLEARED', String(Math.max(0, info.wave - 1)), HEX.text);
    this.statRow(-2, 'PACKAGES STOWED', String(info.stowed), HEX.text);
    this.statRow(52, 'FLAWLESS WAVES', String(info.cleanWaves), info.cleanWaves > 0 ? HEX.good : HEX.text);
    this.statRow(
      106,
      'BEST SCORE',
      formatScore(Math.max(info.bestScore, info.score)),
      info.newBest ? HEX.gold : HEX.textDim,
    );

    if (info.newBest) this.label('NEW PERSONAL BEST', 148, 20, HEX.gold);
    else this.label(`Best run reached wave ${info.bestWave}`, 148, 17, HEX.textDim, false);

    this.modalButton({
      x: 0,
      y: 204,
      width: 480,
      height: 76,
      label: 'RUN AGAIN',
      style: 'primary',
      onClick: () => this.close(actions.onRetry),
    });
    this.modalButton({
      x: 0,
      y: 282,
      width: 320,
      height: 58,
      label: 'MAIN MENU',
      style: 'ghost',
      fontSize: 24,
      onClick: () => this.close(actions.onMenu),
    });

    // Waves are deterministic, so the seed alone replays this exact shift
    // (open the game with ?seed=... to run it again).
    this.label(`SHIFT ${formatSeed(info.seed)}`, 322, 14, '#4b5b70', false);
  }
}
