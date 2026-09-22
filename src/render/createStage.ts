/**
 * Makes a Stage for a render mode. The ONLY place the app reaches the 3D
 * renderer: `import('./three/ThreeStage')` is dynamic, so the three.js chunk
 * is fetched and run only when 3D is actually chosen, and a 2D start never
 * loads it or creates a WebGL context.
 *
 * 3D falls back to 2D on any failure - the module or its three.js chunk will
 * not load (offline, a stale deploy; Vite's `vite:preloadError` also ends up
 * as this import rejecting), WebGL is missing, the context cannot be created,
 * or the first frame's shaders fail. Whatever the failed attempt created is
 * released before the 2D stage is made, so only one canvas is ever left.
 */

import { Canvas2DStage } from './canvas2d/Canvas2DStage';
import type { RenderMode } from './GameView';
import type { Stage, StageOptions } from './Stage';

/** The shape of src/render/three/ThreeStage.ts as far as this module needs it. */
export interface StageModule3D {
  ThreeStage: new (root: HTMLElement, opts: StageOptions) => Stage;
}

export interface CreatedStage {
  stage: Stage;
  /** 3D was asked for and could not start; `stage` is the 2D stage instead. */
  fellBack: boolean;
  /** Why 3D could not start (when fellBack). */
  error?: unknown;
}

/** Seams for tests; the app uses DEFAULT_FACTORIES. */
export interface StageFactories {
  load3d(): Promise<StageModule3D>;
  make2d(root: HTMLElement, opts: StageOptions): Stage;
}

export const DEFAULT_FACTORIES: StageFactories = {
  load3d: () => import('./three/ThreeStage'),
  make2d: (root, opts) => new Canvas2DStage(root, opts),
};

export async function createStage(
  mode: RenderMode,
  root: HTMLElement,
  opts: StageOptions,
  factories: StageFactories = DEFAULT_FACTORIES,
): Promise<CreatedStage> {
  if (mode === '2d') return { stage: factories.make2d(root, opts), fellBack: false };

  const before = new Set<Element>(Array.from(root.children));
  let made: Stage | null = null;
  try {
    const mod = await factories.load3d();
    // A handled vite:preloadError can resolve the import with nothing in it.
    if (!mod || typeof mod.ThreeStage !== 'function') throw new Error('the 3D renderer module did not load');
    made = new mod.ThreeStage(root, opts);
    return { stage: made, fellBack: false };
  } catch (error) {
    if (made) {
      try {
        made.dispose();
      } catch {
        /* already half gone */
      }
    }
    // ThreeStage cleans up after a failed start; this catches anything it could not.
    for (const el of Array.from(root.children)) {
      if (!before.has(el) && el.nodeName === 'CANVAS') el.remove();
    }
    console.warn('[cargo-panic] 3D view unavailable, using 2D:', error);
    return { stage: factories.make2d(root, opts), fellBack: true, error };
  }
}
