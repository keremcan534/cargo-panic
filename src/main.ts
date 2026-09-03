/**
 * Entry point. Boots Phaser at a fixed 720px logical width with a height that
 * matches the device aspect ratio, and locks down the browser gestures that
 * would otherwise fight a full-screen touch game.
 */

import './style.css';
import Phaser from 'phaser';
import { canvasSize, logicalHeight } from './game/render';
import { BootScene } from './game/scenes/BootScene';
import { SplashScene } from './game/scenes/SplashScene';
import { MenuScene } from './game/scenes/MenuScene';
import { LevelSelectScene } from './game/scenes/LevelSelectScene';
import { GameScene } from './game/scenes/GameScene';
import { audio } from './game/systems/AudioManager';

const parent = document.getElementById('game-root') as HTMLElement;

const initial = canvasSize();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent,
  // Device-pixel sized: cameras zoom back to the 720-wide logical space, so
  // sprites are rasterised at the resolution the screen can actually show.
  width: initial.width,
  height: initial.height,
  backgroundColor: '#0d1117',
  antialias: true,
  roundPixels: false,
  powerPreference: 'high-performance',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 2,
    touch: { capture: true },
  },
  fps: { target: 60, min: 30 },
  scene: [BootScene, SplashScene, MenuScene, LevelSelectScene, GameScene],
});

// --- browser gesture lockdown ----------------------------------------------
// Portrait touch game: no scroll, no pinch-zoom, no double-tap zoom, no
// long-press selection or context menu.
const stop = (e: Event) => e.preventDefault();
document.addEventListener('contextmenu', stop);
document.addEventListener('gesturestart', stop);
document.addEventListener('gesturechange', stop);
document.addEventListener('selectstart', stop);
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 320) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false },
);

// --- audio unlock -----------------------------------------------------------
const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock, { once: false });
window.addEventListener('keydown', unlock, { once: false });

document.addEventListener('visibilitychange', () => {
  // Mute-by-suspend is handled by the browser; just make sure we resume cleanly.
  if (!document.hidden) audio.unlock();
});

// --- relayout on real aspect-ratio changes ---------------------------------
// Minor resizes are absorbed by Scale.FIT. Only a genuine shape change (an
// orientation flip, a desktop window drag) is worth rebuilding the stage for.
let resizeTimer = 0;
let lastLogicalHeight = logicalHeight();
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const next = logicalHeight();
    const size = canvasSize();
    if (Math.abs(next - lastLogicalHeight) < 60) {
      game.scale.refresh();
      return;
    }
    lastLogicalHeight = next;
    game.scale.resize(size.width, size.height);
    const active = game.scene.getScenes(true)[0];
    if (active) active.scene.restart(active.scene.settings.data);
  }, 220);
});
