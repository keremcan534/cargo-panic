/**
 * GPU resource cleanup by ownership. A view or backdrop disposes the
 * geometries, materials, textures and shadow maps of everything it built; the
 * shared materials in Materials.ts belong to the stage and are skipped.
 */

import * as THREE from 'three';
import { isShared } from './Materials';

function texturesOf(m: THREE.Material): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const v of Object.values(m)) if (v instanceof THREE.Texture) out.push(v);
  const uniforms = (m as THREE.ShaderMaterial).uniforms;
  if (uniforms) {
    for (const u of Object.values(uniforms)) if (u?.value instanceof THREE.Texture) out.push(u.value);
  }
  return out;
}

/** Disposes a material and the textures it references, unless the stage owns them. */
export function disposeMaterial(m: THREE.Material, includeShared = false) {
  if (!includeShared && isShared(m)) return;
  for (const t of texturesOf(m)) if (includeShared || !isShared(t)) t.dispose();
  m.dispose();
}

/**
 * Detaches `root` and frees what it holds: geometries, non-shared materials
 * and their textures, and light shadow maps. Sprites share one geometry
 * across the whole library, so theirs is left alone.
 */
export function disposeTree(root: THREE.Object3D, includeShared = false) {
  root.removeFromParent();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !(o as THREE.Sprite).isSprite) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) for (const m of Array.isArray(mat) ? mat : [mat]) disposeMaterial(m, includeShared);
    if ((o as THREE.Light).isLight) (o as THREE.Light).dispose();
  });
}
