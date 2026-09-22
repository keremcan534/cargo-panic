/**
 * The Three.js Stage: one WebGL renderer, camera and post chain, plus the
 * pooled particles, camera shake and adaptive bloom every 3D screen shares.
 *
 * It owns no animation loop. The app's FrameLoop advances the tweens, runs
 * the screens' updates and then calls `render(dt)` once per frame. Screens do
 * not touch the scene directly: they get a GameView from `createGameView()`
 * or a menu backdrop from `showBackdrop()`, and dispose what they were given.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { GameView } from '../GameView';
import { StageInitError } from '../Stage';
import type { Backdrop, BackdropKind, QualityPref, Stage, StageOptions } from '../Stage';
import { Tweens } from '../Tween';
import { levelsBackdrop, menuBackdrop } from './backdrops';
import { disposeTree } from './dispose';
import { applyFraming, CAMERA_FOV } from './Framing';
import { releaseSharedMaterials } from './Materials';
import { Particles } from './Particles';
import { ThreeGameView } from './ThreeGameView';

/** Extra camera placement applied after the framing solve (and again on every resize). */
export type FramingAdjust = (camera: THREE.PerspectiveCamera) => void;

/** Beyond this the framebuffer costs more than the sharpness is worth. */
const MAX_DPR = 2;
/** A frame slower than this counts towards the adaptive quality drop. */
const SLOW_FRAME_MS = 26;
/** ~1.5 s of sustained slow frames. */
const SLOW_FRAME_LIMIT = 90;

export class ThreeStage implements Stage {
  readonly mode = '3d' as const;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly tweens = new Tweens();
  readonly particles: Particles;
  readonly gl: THREE.WebGLRenderer;

  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private updaters = new Set<(dtMs: number) => void>();

  private framing: { tiers: number; maxSlots: number; adjust?: FramingAdjust } = { tiers: 2, maxSlots: 5 };
  private shakeAmp = 0;
  private shakeUntil = 0;
  private shakeSeed = 0;
  private basePos = new THREE.Vector3();

  // Adaptive quality: a sustained slow stretch drops bloom once.
  private slowFrames = 0;
  private bloomOn = true;
  private strugglingValue = false;
  private quality: QualityPref;
  private reducedMotion: boolean;
  private disposed = false;

  constructor(
    private parent: HTMLElement,
    opts: Partial<StageOptions> = {},
  ) {
    this.quality = opts.quality ?? 'auto';
    this.reducedMotion = opts.reducedMotion ?? false;
    try {
      this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      throw new StageInitError('3d', e);
    }
    this.gl.setPixelRatio(Math.min(MAX_DPR, window.devicePixelRatio || 1));
    this.gl.setSize(parent.clientWidth, parent.clientHeight);
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 0.95;
    this.gl.domElement.id = 'game-canvas';
    parent.appendChild(this.gl.domElement);

    this.scene.background = new THREE.Color(0x0b1017);
    this.scene.fog = new THREE.FogExp2(0x0b1017, 0.008);

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, this.aspect(), 0.1, 120);
    this.frame(2, 5);

    this.composer = new EffectComposer(this.gl);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(parent.clientWidth, parent.clientHeight),
      0.38,
      0.65,
      0.86,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.particles = new Particles(this.scene);
    if (this.quality === 'low') this.setBloom(false);

    window.addEventListener('resize', this.onResize);
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  get struggling(): boolean {
    return this.strugglingValue;
  }

  private aspect() {
    return Math.max(0.2, this.parent.clientWidth / Math.max(1, this.parent.clientHeight));
  }

  // ==========================================================================
  // Stage
  // ==========================================================================

  createGameView(): GameView {
    return new ThreeGameView(this);
  }

  showBackdrop(kind: BackdropKind): Backdrop {
    return kind === 'menu' ? menuBackdrop(this) : levelsBackdrop(this);
  }

  setReducedMotion(on: boolean) {
    this.reducedMotion = on;
    if (on) this.shakeUntil = 0;
  }

  setQuality(q: QualityPref) {
    this.quality = q;
    this.slowFrames = 0;
    this.strugglingValue = false;
    this.setBloom(q !== 'low');
  }

  /** Draws one frame: backdrop animation, particles, shake, post chain, then slow-frame bookkeeping. */
  render(dtMs: number) {
    if (this.disposed) return;
    for (const u of this.updaters) u(dtMs);
    this.particles.update(dtMs);
    this.applyShake(performance.now());

    this.composer.render();

    if (dtMs > SLOW_FRAME_MS) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > SLOW_FRAME_LIMIT) {
      this.slowFrames = 0;
      // Bloom is the first thing to go; after that there is nothing left to drop.
      if (this.bloomOn && this.quality === 'auto') this.setBloom(false);
      else if (!this.bloomOn) this.strugglingValue = true;
    }
  }

  /**
   * Frees everything: particles, the post chain's render targets and
   * shaders, whatever is still in the scene, the shared materials, and the
   * WebGL context itself. The canvas leaves the DOM.
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.updaters.clear();
    this.tweens.clear();
    this.particles.dispose();
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    for (const child of [...this.scene.children]) disposeTree(child, true);
    releaseSharedMaterials();
    this.scene.background = null;
    this.scene.fog = null;
    this.gl.dispose();
    this.gl.forceContextLoss();
    this.gl.domElement.remove();
  }

  // ==========================================================================
  // Helpers for the 3D view and backdrops
  // ==========================================================================

  /**
   * Re-aims the camera at a rack of this shape, then applies `adjust` (a
   * backdrop's own offset). Both are re-applied on resize.
   */
  frame(tiers: number, maxSlots: number, adjust?: FramingAdjust) {
    this.framing = { tiers, maxSlots, adjust };
    applyFraming(this.camera, this.aspect(), tiers, maxSlots);
    adjust?.(this.camera);
    this.basePos.copy(this.camera.position);
  }

  /** Runs `fn` every frame just before drawing, until the returned function is called. */
  onRender(fn: (dtMs: number) => void): () => void {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  shake(amplitude: number, ms: number) {
    if (this.reducedMotion) return;
    this.shakeAmp = Math.max(this.shakeAmp, amplitude);
    this.shakeUntil = Math.max(this.shakeUntil, performance.now() + ms);
  }

  setBloom(on: boolean) {
    this.bloomOn = on;
    this.bloom.enabled = on;
  }

  private onResize = () => {
    const w = this.parent.clientWidth;
    const h = this.parent.clientHeight;
    this.gl.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.frame(this.framing.tiers, this.framing.maxSlots, this.framing.adjust);
  };

  private applyShake(now: number) {
    if (now >= this.shakeUntil) {
      if (this.shakeAmp > 0) {
        this.shakeAmp = 0;
        this.camera.position.copy(this.basePos);
      }
      return;
    }
    const left = (this.shakeUntil - now) / 1000;
    const amp = this.shakeAmp * Math.min(1, left * 3);
    this.shakeSeed += 0.9;
    this.camera.position.set(
      this.basePos.x + Math.sin(this.shakeSeed * 7.1) * amp,
      this.basePos.y + Math.cos(this.shakeSeed * 5.3) * amp * 0.7,
      this.basePos.z,
    );
  }

  // --- picking --------------------------------------------------------------

  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private plane = new THREE.Plane();
  private hit = new THREE.Vector3();

  private setRay(clientX: number, clientY: number) {
    const r = this.gl.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }

  /** Where the pointer's ray crosses the vertical plane z = planeZ. */
  pointerOnPlane(clientX: number, clientY: number, planeZ: number): THREE.Vector3 | null {
    this.setRay(clientX, clientY);
    this.plane.set(new THREE.Vector3(0, 0, 1), -planeZ);
    return this.ray.ray.intersectPlane(this.plane, this.hit) ? this.hit.clone() : null;
  }

  /** First of `objects` under the pointer, or null. */
  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Object3D | null {
    this.setRay(clientX, clientY);
    const hits = this.ray.intersectObjects(objects, false);
    return hits.length ? hits[0].object : null;
  }

  /** Viewport fraction (0..1) of a world point. */
  toViewport(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  /** Client-space (CSS pixel) position of a world point. */
  toClient(p: THREE.Vector3): { x: number; y: number } {
    const v = this.toViewport(p);
    const r = this.gl.domElement.getBoundingClientRect();
    return { x: r.left + v.x * r.width, y: r.top + v.y * r.height };
  }
}
