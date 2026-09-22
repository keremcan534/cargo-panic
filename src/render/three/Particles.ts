/**
 * Two pooled point-sprite systems (soft dust and hard chips). Fixed-size
 * buffers, no allocation per emit, simple gravity integration on the CPU.
 */

import * as THREE from 'three';
import { chipTexture, glowTexture } from './Materials';

const MAX = 600;

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor, t.a * vAlpha);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

interface Pool {
  points: THREE.Points;
  pos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  color: Float32Array;
  gravity: Float32Array;
  head: number;
  alive: number;
}

export type Burst = 'dust' | 'spark' | 'glass' | 'debris' | 'confetti';

function makePool(map: THREE.Texture, additive: boolean): Pool {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3);
  const size = new Float32Array(MAX);
  const alpha = new Float32Array(MAX);
  const color = new Float32Array(MAX * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 50;
  return {
    points,
    pos,
    vel: new Float32Array(MAX * 3),
    life: new Float32Array(MAX),
    maxLife: new Float32Array(MAX),
    size,
    alpha,
    color,
    gravity: new Float32Array(MAX),
    head: 0,
    alive: 0,
  };
}

const CONFETTI = [0x4da3ff, 0xffc93c, 0x3fd68a, 0xff8f6b, 0xffffff];
const DEBRIS = [0x8d5a24, 0x535f73, 0x3d4a5c, 0xcf9048];
const GLASS = [0xc6f4f6, 0x8fdfe3, 0xffffff];

export class Particles {
  private soft: Pool;
  private chip: Pool;
  private c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.soft = makePool(glowTexture(), true);
    this.chip = makePool(chipTexture(), false);
    scene.add(this.soft.points, this.chip.points);
  }

  emit(kind: Burst, at: THREE.Vector3, count: number, tint?: number) {
    for (let i = 0; i < count; i++) this.spawn(kind, at, tint);
  }

  private spawn(kind: Burst, at: THREE.Vector3, tint?: number) {
    const soft = kind === 'dust';
    const p = soft ? this.soft : this.chip;
    const i = p.head;
    p.head = (p.head + 1) % MAX;
    p.alive = Math.min(MAX, p.alive + 1);

    const r = () => Math.random() * 2 - 1;
    let speed = 1.5;
    let up = 1.2;
    let life = 0.6;
    let size = 0.3;
    let grav = 3;
    let color = tint ?? 0xffffff;

    switch (kind) {
      case 'dust':
        speed = 0.8;
        up = 0.7;
        life = 0.55;
        size = 0.55;
        grav = 0.6;
        color = tint ?? 0xd8c6a8;
        break;
      case 'spark':
        speed = 2.4;
        up = 2.2;
        life = 0.45;
        size = 0.16;
        grav = 7;
        color = tint ?? 0xf0a53c;
        break;
      case 'glass':
        speed = 3.2;
        up = 2.6;
        life = 0.75;
        size = 0.14;
        grav = 8;
        color = GLASS[Math.floor(Math.random() * GLASS.length)];
        break;
      case 'debris':
        speed = 3.4;
        up = 3;
        life = 0.9;
        size = 0.22;
        grav = 9;
        color = DEBRIS[Math.floor(Math.random() * DEBRIS.length)];
        break;
      case 'confetti':
        speed = 4;
        up = 5;
        life = 1.9;
        size = 0.2;
        grav = 5;
        color = CONFETTI[Math.floor(Math.random() * CONFETTI.length)];
        break;
    }

    p.pos[i * 3] = at.x;
    p.pos[i * 3 + 1] = at.y;
    p.pos[i * 3 + 2] = at.z;
    p.vel[i * 3] = r() * speed;
    p.vel[i * 3 + 1] = Math.random() * up;
    p.vel[i * 3 + 2] = r() * speed * 0.6;
    p.life[i] = life * (0.7 + Math.random() * 0.6);
    p.maxLife[i] = p.life[i];
    p.size[i] = size * (0.7 + Math.random() * 0.6);
    p.alpha[i] = 1;
    p.gravity[i] = grav;
    this.c.setHex(color);
    p.color[i * 3] = this.c.r;
    p.color[i * 3 + 1] = this.c.g;
    p.color[i * 3 + 2] = this.c.b;
  }

  update(dtMs: number) {
    const dt = dtMs / 1000;
    for (const p of [this.soft, this.chip]) {
      if (p.alive === 0) continue;
      let any = false;
      for (let i = 0; i < MAX; i++) {
        if (p.life[i] <= 0) continue;
        p.life[i] -= dt;
        if (p.life[i] <= 0) {
          p.alpha[i] = 0;
          p.pos[i * 3 + 1] = -100;
          continue;
        }
        any = true;
        p.vel[i * 3 + 1] -= p.gravity[i] * dt;
        p.pos[i * 3] += p.vel[i * 3] * dt;
        p.pos[i * 3 + 1] += p.vel[i * 3 + 1] * dt;
        p.pos[i * 3 + 2] += p.vel[i * 3 + 2] * dt;
        const t = p.life[i] / p.maxLife[i];
        p.alpha[i] = Math.min(1, t * 2);
      }
      if (!any) p.alive = 0;
      const g = p.points.geometry;
      (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
