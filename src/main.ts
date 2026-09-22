/**
 * Entry point. One stage (Three.js in this build) under one DOM UI root, one
 * frame loop, plus the browser gesture lockdown a full-screen touch game needs.
 */

import './style.css';
import { App } from './app/App';
import { FrameLoop } from './app/FrameLoop';
import { audio } from './game/systems/AudioManager';
import { ThreeStage } from './render/three/ThreeStage';
import { splashScreen } from './ui/Splash';

const root = document.getElementById('game-root') as HTMLElement;
const stage = new ThreeStage(root);
const loop = new FrameLoop();
const app = new App(stage, loop);

// Retire the pre-render HTML splash now that we can paint.
const boot = document.getElementById('boot-splash');
if (boot) {
  boot.classList.add('hidden');
  window.setTimeout(() => boot.remove(), 500);
}

app.start();
app.router.go(splashScreen);

// --- browser gesture lockdown ----------------------------------------------
const stop = (e: Event) => e.preventDefault();
document.addEventListener('contextmenu', stop);
document.addEventListener('gesturestart', stop);
document.addEventListener('gesturechange', stop);
document.addEventListener('selectstart', stop);
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
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

// --- audio unlock ------------------------------------------------------------
window.addEventListener('pointerdown', () => audio.unlock());
window.addEventListener('keydown', () => audio.unlock());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) audio.unlock();
});
