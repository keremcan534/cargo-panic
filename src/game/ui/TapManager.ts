/**
 * Tap routing for every button in the game.
 *
 * Phaser's per-object input never fires for touch pointers in this project, so
 * buttons do their own hit testing from scene-level pointer events instead -
 * the same approach the rack uses to pick up cargo. One code path serves mouse
 * and touch, and hit areas are computed through each object's world transform,
 * so nesting inside a scaled or offset container just works.
 */

import Phaser from 'phaser';

/** Higher layers swallow taps aimed at anything below them. */
export const TAP_LAYER = {
  ui: 20,
  /** Full-screen blocker a modal puts down over the rest of the screen. */
  modalBlocker: 100,
  modal: 110,
} as const;

export interface Tappable {
  /** Sorting weight; the highest hit wins. */
  tapLayer: number;
  /** True when this target swallows the tap without doing anything. */
  tapBlocking?: boolean;
  tapEnabled(): boolean;
  tapHitTest(sceneX: number, sceneY: number): boolean;
  tapPress(down: boolean): void;
  tapActivate(): void;
}

interface Registry {
  targets: Tappable[];
  active: Tappable | null;
}

const registries = new WeakMap<Phaser.Scene, Registry>();

function registryFor(scene: Phaser.Scene): Registry {
  let reg = registries.get(scene);
  if (reg) return reg;

  reg = { targets: [], active: null };
  registries.set(scene, reg);

  const onDown = (pointer: Phaser.Input.Pointer) => {
    const hit = pick(reg as Registry, pointer.worldX, pointer.worldY);
    if (!hit || hit.tapBlocking) return;
    (reg as Registry).active = hit;
    hit.tapPress(true);
  };

  const onMove = (pointer: Phaser.Input.Pointer) => {
    const r = reg as Registry;
    if (!r.active || !pointer.isDown) return;
    if (!r.active.tapHitTest(pointer.worldX, pointer.worldY)) {
      r.active.tapPress(false);
      r.active = null;
    }
  };

  const onUp = (pointer: Phaser.Input.Pointer) => {
    const r = reg as Registry;
    const target = r.active;
    r.active = null;
    if (!target) return;
    target.tapPress(false);
    if (target.tapEnabled() && target.tapHitTest(pointer.worldX, pointer.worldY)) {
      target.tapActivate();
    }
  };

  scene.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
  scene.input.on(Phaser.Input.Events.POINTER_UP, onUp);
  scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
    scene.input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
    scene.input.off(Phaser.Input.Events.POINTER_UP, onUp);
    scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
    registries.delete(scene);
  });

  return reg;
}

function pick(reg: Registry, x: number, y: number): Tappable | null {
  let best: Tappable | null = null;
  for (const t of reg.targets) {
    if (best && t.tapLayer <= best.tapLayer) continue;
    if (!t.tapBlocking && !t.tapEnabled()) continue;
    if (!t.tapHitTest(x, y)) continue;
    best = t;
  }
  return best;
}

export function registerTap(scene: Phaser.Scene, target: Tappable) {
  registryFor(scene).targets.push(target);
}

export function unregisterTap(scene: Phaser.Scene, target: Tappable) {
  const reg = registries.get(scene);
  if (!reg) return;
  const i = reg.targets.indexOf(target);
  if (i >= 0) reg.targets.splice(i, 1);
  if (reg.active === target) reg.active = null;
}

// Scratch objects so hit testing never allocates.
const scratchMatrix = new Phaser.GameObjects.Components.TransformMatrix();
const scratchParent = new Phaser.GameObjects.Components.TransformMatrix();
const scratchPoint = new Phaser.Math.Vector2();

/** True when the object and all of its ancestors are visible. */
export function isShown(obj: Phaser.GameObjects.Container): boolean {
  let node: Phaser.GameObjects.Container | null = obj;
  while (node) {
    if (!node.visible || node.alpha <= 0.02) return false;
    node = node.parentContainer as Phaser.GameObjects.Container | null;
  }
  return true;
}

/**
 * Rectangle hit test in the object's own local space, so container scale,
 * offset and rotation are all accounted for.
 */
export function hitLocalRect(
  obj: Phaser.GameObjects.Container,
  sceneX: number,
  sceneY: number,
  halfW: number,
  halfH: number,
): boolean {
  if (!obj.scene || !isShown(obj)) return false;
  obj.getWorldTransformMatrix(scratchMatrix, scratchParent);
  scratchMatrix.applyInverse(sceneX, sceneY, scratchPoint);
  return Math.abs(scratchPoint.x) <= halfW && Math.abs(scratchPoint.y) <= halfH;
}
