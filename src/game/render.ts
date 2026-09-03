/**
 * Render resolution.
 *
 * The game is authored in a fixed 720-wide logical space, but a phone at
 * devicePixelRatio 3 has roughly 1236 real pixels across that canvas. Rendering
 * at 720 and letting the browser stretch the result blurs every sprite, every
 * label and every hairline by ~70%.
 *
 * So the canvas is created at the *physical* pixel size and every camera is
 * zoomed by the same factor. Scene code keeps working in logical units - it
 * just gets drawn with the detail the screen can actually show.
 */

import Phaser from 'phaser';
import { GAME_H_DEFAULT, GAME_H_MAX, GAME_H_MIN, GAME_W } from './config';

/**
 * Upper bound on the render scale. 2.0 covers a 1440-wide phone panel; beyond
 * that the extra framebuffer costs more than the sharpness is worth on the
 * mid-range hardware this targets.
 */
const MAX_RENDER_SCALE = 2;

/** Logical stage height for the current window, clamped to sane phone ratios. */
export function logicalHeight(): number {
  const vw = window.innerWidth || GAME_W;
  const vh = window.innerHeight || GAME_H_DEFAULT;
  if (vw <= 0 || vh <= 0) return GAME_H_DEFAULT;
  const ideal = Math.round((GAME_W * vh) / vw);
  return Math.max(GAME_H_MIN, Math.min(GAME_H_MAX, ideal));
}

/**
 * How many device pixels the canvas gets per logical unit. Derived from the
 * space the canvas will actually occupy after Scale.FIT, so it matches what the
 * panel can resolve instead of blindly trusting devicePixelRatio.
 */
export function renderScale(): number {
  const dpr = window.devicePixelRatio || 1;
  const vw = window.innerWidth || GAME_W;
  const vh = window.innerHeight || GAME_H_DEFAULT;
  const h = logicalHeight();

  // Scale.FIT picks whichever axis runs out first.
  const fit = Math.min(vw / GAME_W, vh / h);
  const physicalWidth = GAME_W * fit * dpr;

  const scale = physicalWidth / GAME_W;
  return Math.max(1, Math.min(MAX_RENDER_SCALE, scale));
}

/** Canvas size in device pixels for the current window. */
export function canvasSize() {
  const s = renderScale();
  return { width: Math.round(GAME_W * s), height: Math.round(logicalHeight() * s), scale: s };
}

/**
 * Points the scene's camera at the logical 720 x H rectangle, whatever the
 * canvas resolution underneath it happens to be. Call once at the top of
 * `create()`; everything after it works in logical units, including
 * `pointer.worldX` / `worldY`.
 */
export function useLogicalCamera(scene: Phaser.Scene): { w: number; h: number } {
  const cam = scene.cameras.main;
  const scale = cam.width / GAME_W;
  const h = cam.height / scale;

  cam.setZoom(scale);
  // Phaser zooms about the camera midpoint, so the scroll has to be pulled back
  // by half the difference to put logical (0,0) at the top-left of the canvas.
  cam.setScroll((GAME_W / 2) * (1 - scale), (h / 2) * (1 - scale));

  crispenText(scene, scale);

  return { w: GAME_W, h };
}

/**
 * Phaser rasterises Text into its own canvas at the font size in logical
 * pixels, which the camera zoom then magnifies - so labels blur exactly like
 * unscaled sprites did. Every Text added to the scene gets its resolution
 * bumped to match, which is far less error-prone than remembering it at forty
 * call sites.
 */
function crispenText(scene: Phaser.Scene, scale: number) {
  if (scale <= 1.001) return;
  const onAdded = (obj: Phaser.GameObjects.GameObject) => {
    if (obj instanceof Phaser.GameObjects.Text) obj.setResolution(scale);
  };
  scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
  });
}

/**
 * Camera-level grade: a gentle contrast/saturation lift and a soft vignette.
 *
 * Both are single-pass shaders on the camera's existing render target, which is
 * far cheaper than the full-screen bloom it would be tempting to reach for, and
 * does most of the work of making a flat scene look lit. Silently skipped when
 * the renderer falls back to Canvas.
 */
export function applyCameraGrade(scene: Phaser.Scene, strength = 1) {
  if (scene.game.renderer.type !== Phaser.WEBGL) return;
  const fx = scene.cameras.main.postFX;
  if (!fx) return;

  const grade = fx.addColorMatrix();
  grade.contrast(0.08 * strength);
  grade.saturate(0.12 * strength);

  // x, y, radius, strength - a wide, shallow darkening at the corners.
  fx.addVignette(0.5, 0.5, 0.92, 0.28 * strength);
}
