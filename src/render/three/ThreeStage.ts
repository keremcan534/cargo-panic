/**
 * The one WebGL renderer, camera and post chain for the whole game, plus the
 * frame loop everything else hangs off. Screens register an update callback
 * and add/remove their own objects from `scene`.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { applyFraming, CAMERA_FOV } from './Framing';
import { Particles } from './Particles';
import { Tweens } from '../Tween';

/** Beyond this the framebuffer costs more than the sharpness is worth. */
const MAX_DPR = 2;

export type FrameCallback = (dtMs: number) => void;

export class ThreeStage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly tweens = new Tweens();
  readonly particles: Particles;
  readonly gl: THREE.WebGLRenderer;

  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private callbacks = new Set<FrameCallback>();
  private last = performance.now();
  private running = false;

  private framing = { tiers: 2, maxSlots: 5 };
  private shakeAmp = 0;
  private shakeUntil = 0;
  private shakeSeed = 0;
  private basePos = new THREE.Vector3();

  // Adaptive quality: a sustained slow stretch drops bloom once.
  private slowFrames = 0;
  private bloomOn = true;

  constructor(private parent: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
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

    window.addEventListener('resize', this.onResize);
  }

  get domElement() {
    return this.gl.domElement;
  }

  private aspect() {
    return Math.max(0.2, this.parent.clientWidth / Math.max(1, this.parent.clientHeight));
  }

  /** Re-aims the camera at a rack of this shape. Re-applied on resize. */
  frame(tiers: number, maxSlots: number) {
    this.framing = { tiers, maxSlots };
    applyFraming(this.camera, this.aspect(), tiers, maxSlots);
    this.basePos.copy(this.camera.position);
  }

  private onResize = () => {
    const w = this.parent.clientWidth;
    const h = this.parent.clientHeight;
    this.gl.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.frame(this.framing.tiers, this.framing.maxSlots);
  };

  onFrame(cb: FrameCallback) {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  shake(amplitude: number, ms: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amplitude);
    this.shakeUntil = Math.max(this.shakeUntil, performance.now() + ms);
  }

  setBloom(on: boolean) {
    this.bloomOn = on;
    this.bloom.enabled = on;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(50, now - this.last);
      this.last = now;

      this.tweens.update(dt);
      for (const cb of this.callbacks) cb(dt);
      this.particles.update(dt);
      this.applyShake(now);

      this.composer.render();

      if (this.bloomOn) {
        if (dt > 26) this.slowFrames++;
        else this.slowFrames = Math.max(0, this.slowFrames - 2);
        // ~1.5s of sustained slow frames: bloom is the first thing to go.
        if (this.slowFrames > 90) this.setBloom(false);
      }
    };
    requestAnimationFrame(loop);
  }

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
}
