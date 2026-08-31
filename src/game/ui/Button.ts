/**
 * Rounded pill button and small square icon button. Both do their own hit
 * testing through the tap router (see TapManager) so touch and mouse behave
 * identically, and both keep a comfortable finger target regardless of how
 * small they are drawn.
 */

import Phaser from 'phaser';
import { COLORS, FONT, HEX } from '../config';
import { audio } from '../systems/AudioManager';
import { haptics } from '../systems/Haptics';
import { hitLocalRect, registerTap, TAP_LAYER, unregisterTap } from './TapManager';
import type { Tappable } from './TapManager';

export type ButtonStyle = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';

/** Minimum touch target, per mobile accessibility guidance. */
const MIN_TARGET = 52;

interface StyleDef {
  fill: number;
  fillLo: number;
  edge: number;
  text: string;
}

const STYLES: Record<ButtonStyle, StyleDef> = {
  primary: { fill: 0x4da3ff, fillLo: 0x2b6fb8, edge: 0x8cc6ff, text: '#06121f' },
  gold: { fill: 0xf0a53c, fillLo: 0xb87616, edge: 0xffd07a, text: '#1f1200' },
  secondary: { fill: 0x2b3648, fillLo: 0x1c2432, edge: 0x445468, text: HEX.text },
  ghost: { fill: 0x17202c, fillLo: 0x121924, edge: 0x2e3a4b, text: HEX.textDim },
  danger: { fill: 0xff5f57, fillLo: 0xb8362f, edge: 0xff9c96, text: '#280604' },
};

export interface ButtonOpts {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  style?: ButtonStyle;
  fontSize?: number;
  radius?: number;
  /** Defaults to TAP_LAYER.ui; modals raise it so they win overlaps. */
  layer?: number;
  onClick: () => void;
}

export class Button extends Phaser.GameObjects.Container implements Tappable {
  tapLayer: number;

  private bg: Phaser.GameObjects.Graphics;
  private labelText: Phaser.GameObjects.Text;
  private style: ButtonStyle;
  private radius: number;
  private btnW: number;
  private btnH: number;
  private onClick: () => void;

  constructor(scene: Phaser.Scene, opts: ButtonOpts) {
    super(scene, opts.x, opts.y);
    this.btnW = opts.width;
    this.btnH = opts.height;
    this.style = opts.style ?? 'secondary';
    this.radius = opts.radius ?? Math.min(opts.height / 2, 22);
    this.onClick = opts.onClick;
    this.tapLayer = opts.layer ?? TAP_LAYER.ui;

    this.bg = scene.add.graphics();
    this.add(this.bg);

    this.labelText = scene.add
      .text(0, 0, opts.label, {
        fontFamily: FONT,
        fontSize: `${opts.fontSize ?? 30}px`,
        fontStyle: 'bold',
        color: STYLES[this.style].text,
      })
      .setOrigin(0.5);
    this.add(this.labelText);

    this.redraw(false);
    this.setSize(this.btnW, this.btnH);

    registerTap(scene, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => unregisterTap(scene, this));
    scene.add.existing(this);
  }

  // --- Tappable -------------------------------------------------------------

  tapEnabled() {
    return true;
  }

  tapHitTest(x: number, y: number) {
    return hitLocalRect(
      this,
      x,
      y,
      Math.max(this.btnW, MIN_TARGET) / 2,
      Math.max(this.btnH, MIN_TARGET) / 2,
    );
  }

  tapPress(down: boolean) {
    this.redraw(down);
    if (down) audio.unlock();
  }

  tapActivate() {
    audio.click();
    haptics.tap();
    this.onClick();
  }

  // --- drawing --------------------------------------------------------------

  private redraw(pressed: boolean) {
    const s = STYLES[this.style];
    const w = this.btnW;
    const h = this.btnH;
    const r = this.radius;
    const g = this.bg;
    g.clear();

    if (!pressed) {
      g.fillStyle(0x000000, 0.35);
      g.fillRoundedRect(-w / 2, -h / 2 + 5, w, h, r);
    }
    const off = pressed ? 3 : 0;
    g.fillStyle(s.fillLo, 1);
    g.fillRoundedRect(-w / 2, -h / 2 + off, w, h, r);
    g.fillStyle(s.fill, 1);
    g.fillRoundedRect(-w / 2, -h / 2 + off, w, h - 5, r);
    g.lineStyle(2, s.edge, 0.55);
    g.strokeRoundedRect(-w / 2 + 1, -h / 2 + off + 1, w - 2, h - 7, r - 1);

    this.labelText.setY(off - 2);
  }

  setLabel(text: string) {
    this.labelText.setText(text);
    return this;
  }

  setStyleName(style: ButtonStyle) {
    this.style = style;
    this.labelText.setColor(STYLES[style].text);
    this.redraw(false);
    return this;
  }

}

export type IconKind = 'restart' | 'pause' | 'back' | 'sound-on' | 'sound-off' | 'help';

export class IconButton extends Phaser.GameObjects.Container implements Tappable {
  tapLayer: number;

  private bg: Phaser.GameObjects.Graphics;
  private icon: Phaser.GameObjects.Graphics;
  private kind: IconKind;
  private size: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    size: number,
    kind: IconKind,
    private onTap: () => void,
    layer: number = TAP_LAYER.ui,
  ) {
    super(scene, x, y);
    this.size = size;
    this.kind = kind;
    this.tapLayer = layer;

    this.bg = scene.add.graphics();
    this.icon = scene.add.graphics();
    this.add([this.bg, this.icon]);
    this.render(false);
    this.setSize(size, size);

    registerTap(scene, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => unregisterTap(scene, this));
    scene.add.existing(this);
  }

  tapEnabled() {
    return true;
  }

  tapHitTest(x: number, y: number) {
    const half = Math.max(this.size, MIN_TARGET) / 2;
    return hitLocalRect(this, x, y, half, half);
  }

  tapPress(down: boolean) {
    this.render(down);
    if (down) audio.unlock();
  }

  tapActivate() {
    audio.click();
    haptics.tap();
    this.onTap();
  }

  setKind(kind: IconKind) {
    this.kind = kind;
    this.render(false);
  }

  private render(pressed: boolean) {
    const s = this.size;
    const half = s / 2;
    const g = this.bg;
    g.clear();
    g.fillStyle(0x000000, 0.3);
    if (!pressed) g.fillRoundedRect(-half, -half + 4, s, s, 14);
    g.fillStyle(COLORS.panelEdge, 1);
    g.fillRoundedRect(-half, -half + (pressed ? 3 : 0), s, s, 14);
    g.fillStyle(0x212b3a, 1);
    g.fillRoundedRect(-half + 2, -half + 2 + (pressed ? 3 : 0), s - 4, s - 8, 12);

    const i = this.icon;
    i.clear();
    i.x = 0;
    i.y = pressed ? 3 : 0;
    drawIcon(i, this.kind, s);
  }
}

function drawIcon(g: Phaser.GameObjects.Graphics, kind: IconKind, size: number) {
  const c = COLORS.text;
  const u = size / 48;
  g.lineStyle(4 * u, c, 1);
  g.fillStyle(c, 1);

  switch (kind) {
    case 'restart': {
      const r = 11 * u;
      g.beginPath();
      g.arc(0, 1 * u, r, Phaser.Math.DegToRad(-40), Phaser.Math.DegToRad(230), false);
      g.strokePath();
      g.fillTriangle(r * 0.72, -9 * u, r + 6 * u, -3 * u, r - 4 * u, -1 * u);
      break;
    }
    case 'pause': {
      g.fillRoundedRect(-8 * u, -11 * u, 6 * u, 22 * u, 2 * u);
      g.fillRoundedRect(2 * u, -11 * u, 6 * u, 22 * u, 2 * u);
      break;
    }
    case 'back': {
      g.beginPath();
      g.moveTo(5 * u, -11 * u);
      g.lineTo(-6 * u, 0);
      g.lineTo(5 * u, 11 * u);
      g.strokePath();
      break;
    }
    case 'sound-on':
    case 'sound-off': {
      g.fillStyle(c, 1);
      g.beginPath();
      g.moveTo(-11 * u, -4 * u);
      g.lineTo(-5 * u, -4 * u);
      g.lineTo(1 * u, -11 * u);
      g.lineTo(1 * u, 11 * u);
      g.lineTo(-5 * u, 4 * u);
      g.lineTo(-11 * u, 4 * u);
      g.closePath();
      g.fillPath();
      if (kind === 'sound-on') {
        g.lineStyle(3 * u, c, 0.95);
        g.beginPath();
        g.arc(2 * u, 0, 7 * u, Phaser.Math.DegToRad(-52), Phaser.Math.DegToRad(52), false);
        g.strokePath();
        g.beginPath();
        g.arc(2 * u, 0, 12 * u, Phaser.Math.DegToRad(-48), Phaser.Math.DegToRad(48), false);
        g.strokePath();
      } else {
        g.lineStyle(3.5 * u, COLORS.bad, 1);
        g.beginPath();
        g.moveTo(5 * u, -6 * u);
        g.lineTo(14 * u, 6 * u);
        g.moveTo(14 * u, -6 * u);
        g.lineTo(5 * u, 6 * u);
        g.strokePath();
      }
      break;
    }
    case 'help': {
      g.lineStyle(4 * u, c, 1);
      g.beginPath();
      g.arc(0, -4 * u, 7 * u, Phaser.Math.DegToRad(170), Phaser.Math.DegToRad(20), false);
      g.strokePath();
      g.beginPath();
      g.moveTo(6.6 * u, -1 * u);
      g.lineTo(0, 4 * u);
      g.strokePath();
      g.fillCircle(0, 11 * u, 2.6 * u);
      break;
    }
  }
}
