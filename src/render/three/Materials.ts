/**
 * Every material in the game, built once from procedural canvas textures.
 * Nothing loads from disk. Cargo faces carry their own labels (type mark and
 * weight badge) so the front of a box reads at a glance, exactly like the 2D
 * sprites did.
 *
 * Ownership: `MAT` and the per-type cargo materials (with their textures) are
 * shared by every view and belong to the stage - views never dispose them
 * (`isShared`), the stage frees them once in `releaseSharedMaterials`. Every other
 * factory here returns a fresh texture the caller owns.
 */

import * as THREE from 'three';
import { PACKAGE_SPECS } from '../../game/levels/types';
import type { PackageType } from '../../game/levels/types';
import { drawCargoFront, drawCargoSide, drawPriorityTag, drawSealedPlaque, roundRect } from '../art/cargoArt';

export { drawShelfLabel } from '../art/cargoArt';
export type { ShelfLabelState } from '../art/cargoArt';

/** Texture bake resolution per world unit. */
const TEX_PX = 256;

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d') as CanvasRenderingContext2D };
}

function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Front face of a package as a texture. */
function frontTexture(type: PackageType, slots: number, cracked = false): THREE.CanvasTexture {
  const w = Math.round(TEX_PX * (slots - 0.1));
  const h = Math.round(TEX_PX * 0.86);
  const { c, ctx } = makeCanvas(w, h);
  drawCargoFront(ctx, type, w, h, cracked);
  return toTexture(c);
}

/** Plain side/top faces as a texture. */
function sideTexture(type: PackageType): THREE.CanvasTexture {
  const { c, ctx } = makeCanvas(TEX_PX, TEX_PX);
  drawCargoSide(ctx, type, TEX_PX);
  return toTexture(c);
}

export interface CargoMaterials {
  /** [right, left, top, bottom, front, back] as BoxGeometry expects. */
  faces: THREE.Material[];
  /** Front face with cracks, for fragile cargo under load. */
  crackedFront?: THREE.MeshStandardMaterial;
}

const cargoCache = new Map<string, CargoMaterials>();
/** Cargo materials and textures currently in the cache (shared, stage-owned). */
const sharedCargo = new Set<THREE.Material | THREE.Texture>();

function standardish(type: PackageType, map: THREE.Texture): THREE.MeshStandardMaterial {
  switch (type) {
    case 'heavy':
      return new THREE.MeshStandardMaterial({ map, roughness: 0.45, metalness: 0.72 });
    case 'fragile':
      return new THREE.MeshPhysicalMaterial({
        map,
        roughness: 0.22,
        metalness: 0.05,
        clearcoat: 0.55,
        clearcoatRoughness: 0.25,
      });
    case 'priority':
      return new THREE.MeshStandardMaterial({
        map,
        roughness: 0.34,
        metalness: 0.5,
        emissive: new THREE.Color(0x3a2600),
        emissiveIntensity: 0.5,
      });
    default:
      return new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0 });
  }
}

/** Materials for one package type. Cached; do not dispose per instance. */
export function cargoMaterials(type: PackageType): CargoMaterials {
  const key = type;
  const hit = cargoCache.get(key);
  if (hit) return hit;
  const spec = PACKAGE_SPECS[type];
  const side = standardish(type, sideTexture(type));
  const front = standardish(type, frontTexture(type, spec.slots));
  const built: CargoMaterials = { faces: [side, side, side, side, front, side] };
  if (type === 'fragile') built.crackedFront = standardish(type, frontTexture(type, spec.slots, true));
  cargoCache.set(key, built);
  for (const m of cargoResources(built)) sharedCargo.add(m);
  return built;
}

function cargoResources(built: CargoMaterials): (THREE.Material | THREE.Texture)[] {
  const out: (THREE.Material | THREE.Texture)[] = [];
  for (const m of new Set([...built.faces, ...(built.crackedFront ? [built.crackedFront] : [])])) {
    out.push(m);
    const map = (m as THREE.MeshStandardMaterial).map;
    if (map) out.push(map);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Everything that is not cargo
// ---------------------------------------------------------------------------

export const MAT = {
  steel: new THREE.MeshStandardMaterial({ color: 0x748498, roughness: 0.36, metalness: 0.82 }),
  steelDark: new THREE.MeshStandardMaterial({ color: 0x2c3644, roughness: 0.55, metalness: 0.7, side: THREE.DoubleSide }),
  steelLit: new THREE.MeshStandardMaterial({ color: 0x8b9db6, roughness: 0.3, metalness: 0.85 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x131a24, roughness: 0.88, metalness: 0.05 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x1e2a3a, roughness: 0.95, metalness: 0 }),
  bulb: new THREE.MeshBasicMaterial({ color: 0xffe6b8 }),
  belt: new THREE.MeshStandardMaterial({ color: 0x222a37, roughness: 0.85, metalness: 0.1 }),
  roller: new THREE.MeshStandardMaterial({ color: 0x5c6b80, roughness: 0.4, metalness: 0.7 }),
  zone: new THREE.MeshStandardMaterial({ color: 0xffc93c, transparent: true, opacity: 0.16, emissive: new THREE.Color(0xffc93c), emissiveIntensity: 0.35, depthWrite: false }),
  zoneRim: new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.8 }),
  locked: new THREE.MeshStandardMaterial({ color: 0x1a0f08, transparent: true, opacity: 0.72, depthWrite: false }),
  crushBand: new THREE.MeshBasicMaterial({ color: 0x5fb2b6, transparent: true, opacity: 0.11, depthWrite: false }),
  ghostOk: new THREE.MeshBasicMaterial({ color: 0x3fd68a, transparent: true, opacity: 0.22, depthWrite: false }),
  ghostWarn: new THREE.MeshBasicMaterial({ color: 0xf5c451, transparent: true, opacity: 0.24, depthWrite: false }),
  ghostBad: new THREE.MeshBasicMaterial({ color: 0xff5f57, transparent: true, opacity: 0.24, depthWrite: false }),
  overloadGlow: new THREE.MeshBasicMaterial({ color: 0xff5f57, transparent: true, opacity: 0.0, depthWrite: false }),
  homeFill: new THREE.MeshBasicMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0.07, depthWrite: false }),
  homeEdge: new THREE.LineBasicMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0.45, depthWrite: false }),
} as const;

const sharedMat = new Set<THREE.Material>(Object.values(MAT) as THREE.Material[]);

/** True for materials and textures the stage owns; views must not dispose these. */
export function isShared(x: THREE.Material | THREE.Texture): boolean {
  return sharedMat.has(x as THREE.Material) || sharedCargo.has(x);
}

/**
 * Frees every shared material and texture. Called once by the stage on
 * teardown. `MAT` objects stay usable (a later renderer re-uploads them); the
 * cargo cache is emptied so it is rebuilt on demand.
 */
export function releaseSharedMaterials() {
  for (const m of sharedMat) m.dispose();
  for (const x of sharedCargo) x.dispose();
  sharedCargo.clear();
  cargoCache.clear();
}

/** Hazard-striped "OUT OF SERVICE" plaque for a sealed shelf. */
export function sealedTexture(widthUnits: number, text?: string): THREE.CanvasTexture {
  const w = Math.round(TEX_PX * widthUnits);
  const h = Math.round(TEX_PX * 0.86);
  const { c, ctx } = makeCanvas(w, h);
  drawSealedPlaque(ctx, w, h, text);
  return toTexture(c);
}

/** "PRIORITY" tag drawn above a gold zone. */
export function priorityTagTexture(text?: string): THREE.CanvasTexture {
  const { c, ctx } = makeCanvas(TEX_PX * 2, Math.round(TEX_PX * 0.32));
  drawPriorityTag(ctx, c.width, c.height, text);
  return toTexture(c);
}

/** Soft radial sprite for particles and glows. */
export function glowTexture(): THREE.CanvasTexture {
  const size = 64;
  const { c, ctx } = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c, false);
}

/** Small rounded chip for confetti and debris. */
export function chipTexture(): THREE.CanvasTexture {
  const size = 32;
  const { c, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#fff';
  roundRect(ctx, 3, 3, size - 6, size - 6, 6);
  ctx.fill();
  return toTexture(c, false);
}
