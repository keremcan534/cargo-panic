/**
 * The Three.js Stage: one WebGL renderer, camera and post chain, plus the
 * pooled particles, camera shake and quality profiles every 3D screen shares.
 *
 * It owns no animation loop. The app's FrameLoop advances the tweens, runs
 * the screens' updates and then calls `render(dt)` once per frame. Screens do
 * not touch the scene directly: they get a GameView from `createGameView()`
 * or a menu backdrop from `showBackdrop()`, and dispose what they were given.
 *
 * The app never imports this module statically: src/render/createStage.ts
 * loads it with a dynamic import only when the 3D view is chosen, so a 2D
 * start never downloads or runs three.js.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { GameView } from '../GameView';
import { QualityGovernor } from '../quality';
import type { QualityProfile } from '../quality';
import { StageInitError } from '../Stage';
import type { Backdrop, BackdropKind, QualityPref, Stage, StageContextEvent, StageOptions } from '../Stage';
import { Tweens } from '../Tween';
import { levelsBackdrop, menuBackdrop } from './backdrops';
import { disposeTree } from './dispose';
import { applyFraming, CAMERA_FOV } from './Framing';
import { refreshSharedMaterials, releaseSharedMaterials } from './Materials';
import { Particles } from './Particles';
import { ThreeGameView } from './ThreeGameView';

/** Extra camera placement applied after the framing solve (and again on every resize). */
export type FramingAdjust = (camera: THREE.PerspectiveCamera) => void;

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
  private contextListeners = new Set<(e: StageContextEvent) => void>();

  private framing: { tiers: number; maxSlots: number; adjust?: FramingAdjust } = { tiers: 2, maxSlots: 5 };
  private shakeAmp = 0;
  private shakeUntil = 0;
  private shakeSeed = 0;
  private basePos = new THREE.Vector3();

  /** Quality preference plus the adaptive ladder (render/quality.ts). */
  private governor: QualityGovernor;
  private applied: QualityProfile | null = null;
  private reducedMotion: boolean;
  private contextLost = false;
  private shaderFailed = false;
  private started = false;
  private disposed = false;

  /**
   * Throws StageInitError when WebGL is missing, the context cannot be
   * created, or the first frame's shaders fail to compile. Whatever was
   * created by then is released first (listeners, renderer, WebGL context,
   * canvas), so a failed attempt leaves nothing behind.
   */
  constructor(
    private parent: HTMLElement,
    opts: Partial<StageOptions> = {},
  ) {
    this.governor = new QualityGovernor(opts.quality ?? 'auto');
    this.reducedMotion = opts.reducedMotion ?? false;
    try {
      this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      throw new StageInitError('3d', e);
    }
    try {
      const gl = this.gl;
      gl.debug.onShaderError = () => this.onShaderError();
      gl.setSize(parent.clientWidth, parent.clientHeight);
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 0.95;
      gl.domElement.id = 'game-canvas';
      gl.domElement.addEventListener('webglcontextlost', this.onContextLost);
      gl.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
      parent.appendChild(gl.domElement);

      this.scene.background = new THREE.Color(0x0b1017);
      this.scene.fog = new THREE.FogExp2(0x0b1017, 0.008);

      this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, this.aspect(), 0.1, 120);
      this.frame(2, 5);

      this.composer = new EffectComposer(gl);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(parent.clientWidth, parent.clientHeight), 0.38, 0.65, 0.86);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());

      this.particles = new Particles(this.scene);
      this.applyProfile(this.governor.profile);
      window.addEventListener('resize', this.onResize);

      // One frame now compiles the post chain and particle shaders, so a GPU
      // that cannot run them fails here (and the app starts in 2D) instead
      // of mid-game.
      this.composer.render();
      if (this.shaderFailed) throw new Error('a shader failed to compile');
      if (gl.getContext().isContextLost()) throw new Error('the WebGL context was lost during start-up');
      this.started = true;
    } catch (e) {
      this.dispose();
      throw e instanceof StageInitError ? e : new StageInitError('3d', e);
    }
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  get struggling(): boolean {
    return this.governor.struggling;
  }

  /** The preference in force and the profile the stage draws with (tests, debugging). */
  get quality(): { preference: QualityPref; profile: QualityProfile; pixelRatio: number; shadows: boolean } {
    return {
      preference: this.governor.preference,
      profile: { ...this.governor.profile },
      pixelRatio: this.gl.getPixelRatio(),
      shadows: this.gl.shadowMap.enabled,
    };
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

  /** low / high are fixed profiles; auto starts at high and steps down on sustained slow frames. */
  setQuality(q: QualityPref) {
    if (this.disposed) return;
    this.governor.setPreference(q);
    this.applyProfile(this.governor.profile);
  }

  onContextEvent(cb: (e: StageContextEvent) => void): () => void {
    this.contextListeners.add(cb);
    return () => this.contextListeners.delete(cb);
  }

  /** Draws one frame: backdrop animation, particles, shake, post chain, then slow-frame bookkeeping. */
  render(dtMs: number) {
    if (this.disposed || this.contextLost) return;
    for (const u of this.updaters) u(dtMs);
    this.particles.update(dtMs);
    this.applyShake(performance.now());

    this.composer.render();

    if (this.governor.frame(dtMs)) this.applyProfile(this.governor.profile);
  }

  /**
   * Frees everything: particles, the post chain's render targets and
   * shaders, whatever is still in the scene, the shared materials, and the
   * WebGL context itself. The canvas leaves the DOM. Safe on a half-built
   * stage (the constructor calls it when start-up fails) and idempotent.
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.updaters.clear();
    this.contextListeners.clear();
    this.tweens.clear();
    const canvas = this.gl.domElement;
    // forceContextLoss() below fires webglcontextlost: that one is ours, not news.
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    const quietly = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* a half-built or lost context: keep releasing the rest */
      }
    };
    // Fields assigned later in the constructor may not exist on a failed start.
    const particles = this.particles as Particles | undefined;
    const composer = this.composer as EffectComposer | undefined;
    if (particles) quietly(() => particles.dispose());
    if (composer) {
      for (const pass of composer.passes) quietly(() => pass.dispose());
      quietly(() => composer.dispose());
    }
    for (const child of [...this.scene.children]) quietly(() => disposeTree(child, true));
    quietly(() => releaseSharedMaterials());
    // three keeps ONE module-level quad geometry for every Sprite (the lamp
    // halos). The renderer registers a dispose listener on it whose closure
    // holds this GL context, and renderer.dispose() does not remove it - so
    // every disposed stage stayed reachable. Disposing the shared quad fires
    // and clears those listeners; three re-uploads it on next use.
    quietly(() => new THREE.Sprite().geometry.dispose());
    this.scene.background = null;
    this.scene.fog = null;
    this.gl.debug.onShaderError = null;
    quietly(() => this.gl.dispose());
    quietly(() => this.gl.forceContextLoss());
    canvas.remove();
  }

  // ==========================================================================
  // Quality and context
  // ==========================================================================

  /** Bloom, shadows, pixel ratio and particle budget for one profile. */
  private applyProfile(p: QualityProfile) {
    const prev = this.applied;
    this.applied = { ...p };
    this.bloom.enabled = p.bloom;
    if (!prev || prev.shadows !== p.shadows) {
      this.gl.shadowMap.enabled = p.shadows;
      // three.js keys programs on the shadow-map flag but does not re-check
      // it for a built material: everything in use rebuilds its program once.
      if (prev) {
        this.scene.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
        });
        refreshSharedMaterials();
      }
    }
    const ratio = Math.min(p.dprCap, window.devicePixelRatio || 1);
    if (this.gl.getPixelRatio() !== ratio) {
      this.gl.setPixelRatio(ratio);
      this.composer.setPixelRatio(ratio);
      this.onResize();
    }
    this.particles.setBudget(p.particles);
  }

  private emitContext(e: StageContextEvent) {
    for (const cb of [...this.contextListeners]) cb(e);
  }

  private onContextLost = (e: Event) => {
    e.preventDefault(); // lets the browser restore it
    if (this.disposed || this.contextLost) return;
    this.contextLost = true;
    this.emitContext('lost');
  };

  private onContextRestored = () => {
    if (this.disposed || !this.contextLost || this.shaderFailed) return;
    this.contextLost = false;
    this.emitContext('restored');
  };

  /** A shader that fails mid-game cannot be fixed by waiting: reported as a loss that never restores. */
  private onShaderError() {
    this.shaderFailed = true;
    // During start-up the constructor throws instead.
    if (!this.started || this.disposed || this.contextLost) return;
    this.contextLost = true;
    this.emitContext('lost');
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

  private onResize = () => {
    if (this.disposed) return;
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
