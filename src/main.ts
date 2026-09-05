/**
 * Entry point. One WebGL renderer under one DOM UI root, plus the browser
 * gesture lockdown a full-screen touch game needs.
 */

import './style.css';
import { Router } from './app/Router';
import { audio } from './game/systems/AudioManager';
import { Renderer } from './render/Renderer';
import { splashScreen } from './ui/Splash';

const root = document.getElementById('game-root') as HTMLElement;
const renderer = new Renderer(root);
const router = new Router(renderer);

// Retire the pre-render HTML splash now that we can paint.
const boot = document.getElementById('boot-splash');
if (boot) {
  boot.classList.add('hidden');
  window.setTimeout(() => boot.remove(), 500);
}

renderer.start();
router.go(splashScreen);

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
