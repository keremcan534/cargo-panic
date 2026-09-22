/**
 * The building around the rack: floor, back wall, distant racking, three
 * hanging lamps that actually cast light, a warm key from the front so cargo
 * faces read, and the fill that keeps the shadows from going to black.
 */

import * as THREE from 'three';
import { MAT, glowTexture } from './Materials';
import { disposeTree } from './dispose';

export interface WarehouseOpts {
  /** Half-width of the player's rack; sizes the key light's shadow frustum. */
  rackHalfWidth: number;
  /** Lamp x positions. */
  lamps?: number[];
}

export class Warehouse {
  readonly group = new THREE.Group();
  private lampMats: THREE.MeshBasicMaterial[] = [];
  private t = 0;

  constructor(opts: WarehouseOpts) {
    const g = this.group;
    const hw = opts.rackHalfWidth;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), MAT.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);

    const wall = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), MAT.wall);
    wall.position.set(0, 20, -7);
    wall.receiveShadow = true;
    g.add(wall);

    // Distant racking, softened by fog.
    for (const [x, w, h] of [
      [-hw - 5.5, 3.2, 8],
      [-hw - 2.6, 1.8, 6],
      [hw + 5.8, 3.6, 8.5],
      [hw + 3.2, 1.6, 5.5],
    ]) {
      const rack = new THREE.Group();
      for (let s = 0; s < 4; s++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 1.2), MAT.steelDark);
        plank.position.y = 0.6 + s * (h / 4);
        plank.castShadow = true;
        plank.receiveShadow = true;
        rack.add(plank);
      }
      for (const sx of [-1, 1]) {
        const up = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, 0.16), MAT.steelDark);
        up.position.set(sx * (w / 2), h / 2, 0);
        rack.add(up);
      }
      rack.position.set(x, 0, -4.5);
      g.add(rack);
    }

    // Lamps.
    const glow = glowTexture();
    const lamps = opts.lamps ?? [-hw * 0.9, 0, hw * 0.9];
    for (const lx of lamps) {
      const housing = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.45, 24, 1, true), MAT.steelDark);
      housing.position.set(lx, 8.05, 1.5);
      housing.rotation.x = Math.PI;
      g.add(housing);

      const bulbMat = MAT.bulb.clone();
      this.lampMats.push(bulbMat);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), bulbMat);
      bulb.position.set(lx, 7.8, 1.5);
      g.add(bulb);

      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glow,
          color: 0xffd28a,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      halo.scale.set(1.6, 1.2, 1);
      halo.position.set(lx, 7.75, 1.5);
      g.add(halo);

      const spot = new THREE.SpotLight(0xffd9a0, 80, 24, Math.PI / 4.2, 0.6, 1.5);
      spot.position.set(lx, 7.6, 1.5);
      spot.target.position.set(lx * 0.5, 0, 0.5);
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.0008;
      spot.shadow.radius = 4;
      g.add(spot, spot.target);
    }

    g.add(new THREE.HemisphereLight(0x4a6088, 0x0a0d12, 0.9));

    // Frontal warm key so box faces - what the puzzle is read from - are lit.
    const key = new THREE.DirectionalLight(0xffe0b8, 1.7);
    key.position.set(3, 7, 11);
    key.target.position.set(0, 2.5, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -(hw + 2);
    key.shadow.camera.right = hw + 2;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -1;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0006;
    g.add(key, key.target);

    const rim = new THREE.DirectionalLight(0x8fb4ff, 0.5);
    rim.position.set(-7, 5, 6);
    g.add(rim);

    // Warm pool on the floor where the rack stands.
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 3.2, 5),
      new THREE.MeshBasicMaterial({
        map: glow,
        color: 0xffd9a0,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.01, 0.6);
    g.add(pool);
  }

  /** Gentle flicker on the bulbs. */
  tick(dtMs: number) {
    this.t += dtMs / 1000;
    this.lampMats.forEach((m, i) => {
      const f = 0.92 + Math.sin(this.t * 2.1 + i * 1.7) * 0.05 + Math.sin(this.t * 7.3 + i) * 0.03;
      m.color.setRGB(1 * f, 0.9 * f, 0.72 * f);
    });
  }

  /** Frees geometry, lamp/halo/pool materials, the glow texture and every shadow map. */
  dispose() {
    disposeTree(this.group);
  }
}
