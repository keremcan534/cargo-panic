/**
 * The intake belt in the foreground. The live package sits left of centre;
 * the next two wait to its right, dimmed. The belt texture scrolls towards the
 * pickup point and slows to a crawl while the player is dragging.
 */

import * as THREE from 'three';
import { W3 } from '../../../game/config';
import { MAT } from '../Materials';
import { disposeTree } from '../dispose';

function beltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#2b3444');
  g.addColorStop(0.5, '#222a37');
  g.addColorStop(1, '#171e28');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, 8, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(8, 0, 4, 64);
  ctx.strokeStyle = 'rgba(240,165,60,0.32)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(78, 14);
  ctx.lineTo(48, 32);
  ctx.lineTo(78, 50);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export class Conveyor3D {
  readonly group = new THREE.Group();
  /** World x of the package in hand. */
  readonly liveX: number;
  /** World x of the two "up next" positions. */
  readonly queueX: [number, number];
  /** World y of cargo centres resting on the belt. */
  readonly cargoY: number;
  readonly z = W3.beltZ;

  private tex: THREE.CanvasTexture;
  private beltMat: THREE.MeshStandardMaterial;
  private speed = 0.35;
  /** The belt is the target being shown: it glows blue (pulsing unless reduced motion). */
  private hover = false;
  private hoverTime = 0;

  constructor(parent: THREE.Object3D, halfWidth: number) {
    const w = halfWidth * 2 + 9;
    this.liveX = -halfWidth * 0.5;
    this.queueX = [halfWidth * 0.18, halfWidth * 0.68];
    this.cargoY = W3.beltH + W3.cargoH / 2 + 0.005;

    this.tex = beltTexture();
    this.tex.repeat.set(w / 1.0, 1);
    const beltMat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.85, metalness: 0.1 });
    beltMat.emissive.setHex(0x4da3ff);
    beltMat.emissiveIntensity = 0;
    this.beltMat = beltMat;
    const belt = new THREE.Mesh(new THREE.BoxGeometry(w, W3.beltH, 1.15), beltMat);
    belt.position.set(0, W3.beltH / 2, this.z);
    belt.receiveShadow = true;
    belt.castShadow = true;
    this.group.add(belt);

    // Side rails and rollers.
    for (const sz of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.08, 0.08), MAT.steelDark);
      rail.position.set(0, W3.beltH + 0.02, this.z + sz * 0.6);
      this.group.add(rail);
    }
    for (const sx of [-1, 1]) {
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.2, 16), MAT.roller);
      roller.rotation.x = Math.PI / 2;
      roller.position.set(sx * (w / 2 + 0.02), W3.beltH / 2, this.z);
      this.group.add(roller);
    }
    // Legs.
    for (const sx of [-0.8, 0.8]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), MAT.steelDark);
      leg.position.set(sx * (w / 2), -0.2, this.z);
      this.group.add(leg);
    }

    parent.add(this.group);
  }

  setDragging(on: boolean) {
    this.speed = on ? 0.08 : 0.35;
  }

  setHover(on: boolean) {
    this.hover = on;
    this.hoverTime = 0;
    if (!on) this.beltMat.emissiveIntensity = 0;
  }

  /** Scrolls the belt and pulses the hover glow; `still` (reduced motion) stops the belt and holds the glow. */
  tick(dtMs: number, still = false) {
    if (!still) this.tex.offset.x -= (this.speed * dtMs) / 1000;
    if (!this.hover) return;
    this.hoverTime += dtMs;
    const v = still ? 0.7 : 0.5 - 0.5 * Math.cos((this.hoverTime / 700) * Math.PI * 2);
    this.beltMat.emissiveIntensity = 0.35 + v * 0.35;
  }

  /** Frees the belt geometry, its material and scrolling texture. */
  dispose() {
    disposeTree(this.group);
    this.tex.dispose();
  }
}
