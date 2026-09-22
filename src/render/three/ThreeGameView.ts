/**
 * The 3D game view: the warehouse, rack, belt and cargo meshes, and every
 * animation the old controller ran on them - drag easing, landing effects,
 * the hint pulse, spills, shatters, the dispatch ride-off and the confetti.
 *
 * It draws the BoardView it is handed and turns pointer positions into
 * semantic targets. It never judges a move: the controller asks the
 * GameSession and then calls a transition (cargoPlaced / cargoToBelt /
 * cargoReturn) followed by sync().
 */

import * as THREE from 'three';
import { W3 } from '../../game/config';
import type { LevelDef } from '../../game/levels/types';
import type { TargetKind } from '../../game/session/types';
import { PlacementSystem } from '../../game/systems/PlacementSystem';
import type {
  BoardView,
  ClientPoint,
  DispatchCallbacks,
  DropTarget,
  GameView,
  PointerSample,
  ViewHighlight,
} from '../GameView';
import { BELT_ZONE_3D } from '../layout';
import { Easing } from '../Tween';
import type { ThreeStage } from './ThreeStage';
import { Warehouse } from './Warehouse';
import { Cargo3D } from './world/Cargo3D';
import { Conveyor3D } from './world/Conveyor3D';
import { Rack3D } from './world/Rack3D';
import type { StowedCargo } from './world/Rack3D';

interface Falling {
  cargo: Cargo3D;
  vel: THREE.Vector3;
  spin: number;
  settled: boolean;
}

export class ThreeGameView implements GameView {
  readonly mode = '3d' as const;

  private level!: LevelDef;
  private board!: BoardView;
  private rack!: Rack3D;
  private conveyor!: Conveyor3D;
  private warehouse!: Warehouse;
  private cargo: Cargo3D[] = [];
  private falling: Falling[] = [];
  private timers: number[] = [];
  private stops: (() => void)[] = [];

  /** Package in the player's hand. */
  private dragged: Cargo3D | null = null;
  /** Package just let go of, until its transition call arrives. */
  private released: Cargo3D | null = null;
  private dragGrab = new THREE.Vector3();
  private pointer = { x: 0, y: 0 };
  private dragLift = 0;
  private dragLiftTarget = 0;
  private dragZ: number = W3.dragZ;
  private target: DropTarget | null = null;

  /** An outcome has been shown; drags and transitions are over. */
  private concluded = false;
  /** dispatch() or fail*() ran; the rack no longer follows the board. */
  private frozen = false;
  private mounted = false;

  constructor(private stage: ThreeStage) {}

  private get tweens() {
    return this.stage.tweens;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  mount(board: BoardView) {
    const s = this.stage;
    this.board = board;
    this.level = board.level;
    const tiers = this.level.shelves.length;
    const maxSlots = Math.max(...this.level.shelves.map((sh) => sh.slots));
    s.frame(tiers, maxSlots);

    this.rack = new Rack3D(s.tweens, this.level, s.scene);
    this.warehouse = new Warehouse({ rackHalfWidth: this.rack.halfWidth });
    s.scene.add(this.warehouse.group);
    this.conveyor = new Conveyor3D(s.scene, this.rack.halfWidth);

    for (let id = 0; id < this.level.packages.length; id++) {
      const c = new Cargo3D(s.tweens, id, this.level.packages[id]);
      c.mesh.visible = false;
      s.scene.add(c.mesh);
      this.cargo.push(c);
    }
    for (const p of board.placements) this.placeInstant(this.cargo[p.id], p.shelf, p.slot);
    this.mounted = true;
    this.refreshQueue(true);
    this.applyBoardVisuals();
  }

  sync(board: BoardView) {
    this.board = board;
    if (!this.mounted || this.frozen) return;
    this.reconcile();
    this.applyBoardVisuals();
    this.refreshQueue();
  }

  update(dtMs: number) {
    if (!this.mounted) return;
    this.rack.tick(dtMs);
    this.conveyor.tick(dtMs);
    this.warehouse.tick(dtMs);
    if (this.dragged) this.updateDrag(dtMs);
    this.updateFalling(dtMs);
  }

  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const stop of this.stops) stop();
    this.stops = [];
    this.dragged = null;
    this.released = null;
    this.falling = [];
    for (const c of this.cargo) c.dispose();
    this.cargo = [];
    if (this.mounted) {
      this.rack.dispose();
      this.conveyor.dispose();
      this.warehouse.dispose();
    }
    this.mounted = false;
  }

  private after(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  /** Tweens the view starts on objects it made up itself (fades), so dispose can stop them. */
  private track(stop: () => void) {
    this.stops.push(stop);
  }

  // ==========================================================================
  // Board -> meshes
  // ==========================================================================

  /** Moves every package that is neither in hand nor mid-transition to where the board says. */
  private reconcile() {
    const at = new Map(this.board.placements.map((p) => [p.id, p]));
    for (const c of this.cargo) {
      if (c === this.dragged || c === this.released || c.state === 'falling') continue;
      const p = at.get(c.id);
      if (p) {
        if (c.state !== 'placed' || c.shelf !== p.shelf || c.slot !== p.slot) {
          this.commitPlacement(c, p.shelf, p.slot, true);
        }
      } else if (c.state === 'placed') {
        // The board took it off the rack without a drag (e.g. undo): back to the belt.
        this.toBeltState(c);
      }
    }
  }

  /** Tilt, wobble, shelf labels, overload glow, fragile cracks and crush columns - all from the committed board. */
  private applyBoardVisuals() {
    if (!this.mounted || this.frozen) return;
    const ev = this.board.evaluation;
    this.rack.setBalance(ev.net, this.level.balanceTolerance, this.board.wobble);
    for (const s of this.rack.shelves) {
      s.setLoad(ev.shelfWeights[s.tier]);
      s.setOverloaded(ev.overloaded.includes(s.tier));
    }
    for (const c of this.cargo) if (c.type === 'fragile') c.setCracking(ev.crushed.includes(c.id));
    this.updateColumns();
  }

  private updateColumns() {
    const stowed: StowedCargo[] = this.board.placements.map((p) => ({
      type: p.type,
      shelf: p.shelf,
      slot: p.slot,
      slots: this.cargo[p.id].slots,
    }));
    this.rack.updateCrushColumns(stowed, !!this.dragged && PlacementSystem.isCrusher(this.dragged.type));
  }

  /** Belt layout: the live package full size, the next two dimmed, the rest hidden. */
  private refreshQueue(instant = false) {
    const cv = this.conveyor;
    const queue = this.board.queue;
    for (const c of this.cargo) {
      if (c.state === 'placed' || c.state === 'falling' || c === this.dragged || c === this.released) continue;
      const qi = queue.indexOf(c.id);
      if (qi < 0) {
        c.mesh.visible = false;
        continue;
      }
      const tw = this.tweens;
      tw.kill(c.mesh.position);
      c.mesh.visible = true;
      if (qi === 0) {
        c.setOpacity(1);
        c.mesh.scale.set(1, 1, 1);
        if (instant) {
          c.mesh.position.set(cv.liveX, cv.cargoY, cv.z);
        } else {
          if (c.mesh.position.z < cv.z - 0.5) c.mesh.position.set(cv.liveX - 4, cv.cargoY, cv.z);
          tw.add(c.mesh.position, { x: cv.liveX, y: cv.cargoY, z: cv.z }, { ms: 320, ease: Easing.backOut });
        }
      } else if (qi <= 2) {
        const x = cv.queueX[qi - 1];
        c.setOpacity(0.62);
        if (instant) {
          c.mesh.position.set(x, cv.cargoY, cv.z);
          c.mesh.scale.set(0.86, 0.86, 0.86);
        } else {
          tw.add(c.mesh.position, { x, y: cv.cargoY, z: cv.z }, { ms: 280 });
          tw.add(c.mesh.scale, { x: 0.86, y: 0.86, z: 0.86 }, { ms: 280 });
        }
      } else {
        c.mesh.visible = false;
        c.mesh.position.set(cv.queueX[1] + 2.2, cv.cargoY, cv.z);
        c.mesh.scale.set(0.86, 0.86, 0.86);
      }
    }
  }

  private placedCargo() {
    return this.cargo.filter((c) => c.state === 'placed');
  }

  /** Puts a package in its slot with no animation. */
  private placeInstant(c: Cargo3D, tier: number, slot: number) {
    const shelf = this.rack.shelves[tier];
    this.tweens.kill(c.mesh.position);
    this.rack.group.add(c.mesh);
    c.mesh.position.set(shelf.slotCentreX(slot, c.slots), shelf.cargoCentreY, 0.02);
    c.mesh.rotation.set(0, 0, 0);
    c.mesh.scale.set(1, 1, 1);
    c.mesh.visible = true;
    c.setOpacity(1);
    c.state = 'placed';
    c.shelf = tier;
    c.slot = slot;
  }

  private toBeltState(c: Cargo3D) {
    if (c.mesh.parent !== this.stage.scene) this.rack.detach(c, this.stage.scene);
    c.state = 'queued';
    c.shelf = -1;
    c.slot = -1;
  }

  // ==========================================================================
  // Pointer -> semantic target
  // ==========================================================================

  pickCargo(p: PointerSample, candidates: readonly number[]): number | null {
    if (!this.mounted || this.concluded) return null;
    const meshes: THREE.Object3D[] = [];
    for (const id of candidates) {
      const c = this.cargo[id];
      if (!c || !c.mesh.visible) continue;
      if (c.state === 'queued' || c.state === 'placed') meshes.push(c.mesh);
    }
    const hit = this.stage.pick(p.clientX, p.clientY, meshes);
    return hit ? (hit.userData.cargoId as number) : null;
  }

  beginDrag(cargoId: number, p: PointerSample) {
    const c = this.cargo[cargoId];
    if (!c || !this.mounted || this.concluded) return;
    this.dragged = c;
    this.target = null;
    const wasPlaced = c.state === 'placed';
    c.state = 'dragging';
    c.mesh.visible = true;
    c.setOpacity(1);

    if (wasPlaced) {
      // Only the mesh moves. The rules still count it in its slot, so the
      // rack keeps its tilt and the slot gets a faint outline.
      this.rack.detach(c, this.stage.scene);
      this.tweens.add(c.mesh.rotation, { z: 0 }, { ms: 140 });
      this.rack.showHome(c.shelf, c.slot, c.slots);
    }
    this.tweens.kill(c.mesh.position);
    c.setDragging(true);

    this.pointer = { x: p.clientX, y: p.clientY };
    this.dragLift = 0;
    this.dragLiftTarget = p.touch ? W3.touchLift : 0;
    // Start the drag plane where the cargo is, then ease it in to the shelves.
    this.dragZ = c.mesh.position.z;
    const hit = this.stage.pointerOnPlane(p.clientX, p.clientY, this.dragZ);
    if (hit) {
      this.dragGrab.set(c.mesh.position.x - hit.x, c.mesh.position.y - hit.y, 0);
      if (Math.abs(this.dragGrab.x) > c.width * 0.4) this.dragGrab.x = 0;
      this.dragGrab.y = Math.max(-W3.cargoH * 0.5, Math.min(W3.cargoH * 0.5, this.dragGrab.y));
    } else {
      this.dragGrab.set(0, 0, 0);
    }

    this.conveyor.setDragging(true);
    this.updateColumns();
  }

  moveDrag(p: PointerSample) {
    if (!this.dragged) return;
    this.pointer = { x: p.clientX, y: p.clientY };
  }

  private updateDrag(dtMs: number) {
    const c = this.dragged;
    if (!c) return;
    const k = 1 - Math.pow(0.0004, dtMs / 1000);
    this.dragLift += (this.dragLiftTarget - this.dragLift) * k;
    this.dragZ += (W3.dragZ - this.dragZ) * k;

    const p = this.stage.pointerOnPlane(this.pointer.x, this.pointer.y, this.dragZ);
    if (!p) return;
    c.mesh.position.set(p.x + this.dragGrab.x, p.y + this.dragGrab.y + this.dragLift, this.dragZ);
    // The slot under the package as drawn wins; the belt only when it is over no slot.
    this.target = this.slotUnder(c.mesh.position, c.slots) ?? (this.inBeltBand(this.pointer.y) ? { kind: 'belt' } : null);
  }

  /** Slot under a world point for a package `slots` wide (shared hit-test on the rack-local position). */
  private slotUnder(at: THREE.Vector3, slots: number): DropTarget | null {
    const local = this.rack.toLocal(at);
    const tier = this.rack.nearestShelf(local.x, local.y);
    if (tier < 0) return null;
    return { kind: 'slot', shelf: tier, slot: this.rack.shelves[tier].slotFromX(local.x, slots) };
  }

  /** The 3D belt area: the bottom band of the canvas. */
  private inBeltBand(clientY: number): boolean {
    const rect = this.stage.canvas.getBoundingClientRect();
    return (clientY - rect.top) / rect.height > BELT_ZONE_3D;
  }

  dragTarget(): DropTarget | null {
    return this.dragged ? this.target : null;
  }

  /** Taps have no lift, so the belt band wins, then the slot under the point. */
  targetAt(p: PointerSample, slots: number): DropTarget | null {
    if (!this.mounted) return null;
    if (this.inBeltBand(p.clientY)) return { kind: 'belt' };
    const at = this.stage.pointerOnPlane(p.clientX, p.clientY, W3.dragZ);
    return at ? this.slotUnder(at, slots) : null;
  }

  endDrag() {
    const c = this.dragged;
    if (!c) return;
    this.dragged = null;
    this.released = c;
    this.target = null;
    this.conveyor.setDragging(false);
    this.rack.hideGhost();
    this.rack.hideHome();
    c.setDragging(false);
    this.updateColumns();
  }

  // ==========================================================================
  // Feedback
  // ==========================================================================

  showGhost(target: { shelf: number; slot: number }, slots: number, kind: TargetKind) {
    this.rack.showGhost(target.shelf, target.slot, slots, kind);
  }

  hideGhost() {
    this.rack.hideGhost();
  }

  /** The 3D belt highlight is the DOM "BACK ON THE BELT" overlay the controller owns; nothing to draw here. */
  setBeltHover(_on: boolean) {}

  /** Tap-to-select arrives in A3; nothing selects in this build. */
  setSelected(_cargoId: number | null) {}

  showHint(cargoId: number, target: { shelf: number; slot: number }) {
    const c = this.cargo[cargoId];
    if (!c) return;
    c.setHinted(true);
    this.rack.showGhost(target.shelf, target.slot, c.slots, 'ok');
  }

  clearHint() {
    for (const c of this.cargo) c.setHinted(false);
    if (!this.dragged) this.rack.hideGhost();
  }

  /** Loss-reason and tutorial pointers arrive in A3; nothing highlights in this build. */
  highlight(_h: ViewHighlight) {}

  // ==========================================================================
  // Transitions
  // ==========================================================================

  private takeReleased(c: Cargo3D) {
    if (this.released === c) this.released = null;
  }

  cargoPlaced(cargoId: number, target: { shelf: number; slot: number }, opts: { quiet: boolean; onLanded?: () => void }) {
    const c = this.cargo[cargoId];
    if (!c || this.concluded) return;
    this.takeReleased(c);
    this.commitPlacement(c, target.shelf, target.slot, opts.quiet, opts.onLanded);
  }

  cargoToBelt(cargoId: number) {
    const c = this.cargo[cargoId];
    if (!c || this.concluded) return;
    this.takeReleased(c);
    this.returnToBelt(c);
  }

  cargoReturn(cargoId: number) {
    const c = this.cargo[cargoId];
    if (!c || this.concluded) return;
    this.takeReleased(c);
    const p = this.board.placements.find((pl) => pl.id === cargoId);
    if (p) this.commitPlacement(c, p.shelf, p.slot, true);
    else this.returnToBelt(c);
    this.applyBoardVisuals();
    this.refreshQueue();
  }

  /** Flies a package into its slot; heavier and farther drops take a little longer. */
  private commitPlacement(c: Cargo3D, tier: number, slot: number, quiet: boolean, onLanded?: () => void) {
    const shelf = this.rack.shelves[tier];
    this.rack.attach(c);
    c.state = 'placed';
    c.shelf = tier;
    c.slot = slot;
    c.mesh.visible = true;

    const tx = shelf.slotCentreX(slot, c.slots);
    const ty = shelf.cargoCentreY;
    const dist = Math.hypot(c.mesh.position.x - tx, c.mesh.position.y - ty, c.mesh.position.z);
    const ms = quiet ? 140 : Math.max(130, Math.min(300, 90 + dist * 60));
    this.tweens.kill(c.mesh.position);
    this.tweens.add(c.mesh.position, { x: tx, y: ty, z: 0.02 }, {
      ms,
      ease: quiet ? Easing.quadOut : Easing.backIn,
      onDone: () => this.landed(c, tier, quiet, onLanded),
    });
    this.tweens.add(c.mesh.rotation, { x: 0, y: 0, z: 0 }, { ms });
  }

  /** Touchdown: squash, shelf flex, and for a real placement dust, sparks and a thud. */
  private landed(c: Cargo3D, tier: number, quiet: boolean, onLanded?: () => void) {
    if (!this.mounted) return;
    const shelf = this.rack.shelves[tier];
    c.landBounce(c.weight);
    shelf.flex(c.weight);
    if (!quiet) {
      const at = c.worldPosition();
      at.y -= W3.cargoH / 2;
      at.z += W3.cargoD / 2;
      this.stage.particles.emit('dust', at, 5 + c.weight);
      if (c.type === 'heavy') {
        this.stage.shake(0.06, 160);
        this.stage.particles.emit('spark', at, 6, 0xf0a53c);
      }
    }
    onLanded?.();
    this.applyBoardVisuals();
  }

  /** Back to the front of the belt (from the hand or from a shelf). */
  private returnToBelt(c: Cargo3D) {
    this.toBeltState(c);
    c.setCracking(false);
    c.setHinted(false);
    const cv = this.conveyor;
    this.tweens.kill(c.mesh.position);
    this.tweens.add(c.mesh.position, { x: cv.liveX, y: cv.cargoY, z: cv.z }, {
      ms: 260,
      ease: Easing.backOut,
      onDone: () => this.refreshQueue(true),
    });
    this.tweens.add(c.mesh.rotation, { z: 0 }, { ms: 200 });
  }

  // ==========================================================================
  // Outcomes
  // ==========================================================================

  /** Ends any drag: the package in hand snaps to its committed spot so it takes part in the outcome. */
  private settleHand() {
    const c = this.dragged ?? this.released;
    this.dragged = null;
    this.released = null;
    this.target = null;
    this.rack.hideGhost();
    this.rack.hideHome();
    this.conveyor.setDragging(false);
    if (!c) return;
    c.setDragging(false);
    const p = this.board.placements.find((pl) => pl.id === c.id);
    if (p) {
      this.placeInstant(c, p.shelf, p.slot);
      return;
    }
    const cv = this.conveyor;
    this.toBeltState(c);
    this.tweens.kill(c.mesh.position);
    c.mesh.position.set(cv.liveX, cv.cargoY, cv.z);
    c.mesh.rotation.set(0, 0, 0);
    c.mesh.scale.set(1, 1, 1);
  }

  private conclude(freeze: boolean) {
    this.settleHand();
    this.concluded = true;
    if (freeze) this.frozen = true;
    this.updateColumns();
  }

  celebrate() {
    this.conclude(false);
    const at = new THREE.Vector3(0, this.rack.topY + 0.5, 1);
    const particles = this.stage.particles;
    particles.emit('confetti', at, 46);
    this.after(220, () => particles.emit('confetti', new THREE.Vector3(-2, this.rack.topY, 1), 26));
    this.after(400, () => particles.emit('confetti', new THREE.Vector3(2, this.rack.topY, 1), 26));
    this.rack.celebrate();
  }

  /** Cargo rides off to the right, like a truck taking the load; the rack levels and empties. */
  dispatch(cb?: DispatchCallbacks) {
    this.conclude(true);
    const packages = this.placedCargo().sort((a, b) => a.mesh.position.x - b.mesh.position.x);
    packages.forEach((c, i) => {
      this.rack.detach(c, this.stage.scene);
      c.setCracking(false);
      c.state = 'falling';
      c.shelf = -1;
      c.slot = -1;
      const at = c.worldPosition();
      const fade = { v: 1 };
      this.tweens.add(c.mesh.position, { x: at.x + 14, y: at.y + 0.3 }, {
        ms: 540,
        delay: i * 55,
        ease: Easing.backIn,
      });
      this.track(
        this.tweens.add(fade, { v: 0 }, {
          ms: 540,
          delay: i * 55,
          ease: Easing.quadIn,
          onUpdate: () => c.setOpacity(fade.v),
        }),
      );
      this.after(i * 55, () => {
        const dust = c.worldPosition();
        dust.y -= W3.cargoH / 2;
        this.stage.particles.emit('dust', dust, 4);
        cb?.onEach?.(c.id, i);
      });
    });
    this.after(Math.max(0, packages.length - 1) * 55 + 540, () => cb?.onDone?.());

    // The board visuals of an empty rack.
    this.rack.setBalance(0, this.level.balanceTolerance, false);
    for (const s of this.rack.shelves) {
      s.setLoad(0);
      s.setOverloaded(false);
    }
    for (const c of this.cargo) if (c.type === 'fragile') c.setCracking(false);
    this.rack.updateCrushColumns([], false);
  }

  failCollapse(direction: number) {
    this.conclude(true);
    this.stage.shake(0.32, 620);
    this.rack.collapse(direction, () => undefined);
    this.after(180, () => this.spillCargo(this.placedCargo(), direction));
  }

  failOverload(tier: number, direction: number) {
    this.conclude(true);
    this.stage.shake(0.22, 480);
    const victims = this.placedCargo().filter((c) => c.shelf <= tier);
    this.after(120, () => this.spillCargo(victims, direction));
  }

  failFragile(cargoId: number) {
    this.conclude(true);
    this.stage.shake(0.16, 320);
    const c = this.cargo[cargoId];
    if (c && c.state === 'placed') {
      this.stage.particles.emit('glass', c.worldPosition(), 26);
      this.tweens.add(c.mesh.scale, { x: 1.25, y: 0.7 }, { ms: 220 });
      const fade = { v: 1 };
      this.track(this.tweens.add(fade, { v: 0 }, { ms: 220, onUpdate: () => c.setOpacity(fade.v) }));
    }
  }

  /** Deterministic per package id - a replay of the same board looks the same. */
  private spillCargo(victims: Cargo3D[], dir: number) {
    victims.forEach((c, i) => {
      this.rack.detach(c, this.stage.scene);
      c.setCracking(false);
      c.state = 'falling';
      const r = ((c.id * 9301 + 49297) % 233280) / 233280;
      this.after(i * 45, () => {
        this.falling.push({
          cargo: c,
          vel: new THREE.Vector3(dir * (1.5 + r * 3) + (r - 0.5) * 2, 1 + r * 2, 1.2 + r),
          spin: dir * (2 + r * 5),
          settled: false,
        });
      });
    });
  }

  /** Cargo knocked off the rack: a tiny deterministic tumble, no physics engine. */
  private updateFalling(dtMs: number) {
    const s = dtMs / 1000;
    for (const f of this.falling) {
      if (f.settled) continue;
      const m = f.cargo.mesh;
      f.vel.y -= 14 * s;
      m.position.addScaledVector(f.vel, s);
      m.rotation.z += f.spin * s;
      const floor = W3.cargoH / 2 + 0.02;
      if (m.position.y <= floor) {
        m.position.y = floor;
        if (Math.abs(f.vel.y) > 1.2) {
          f.vel.y = -f.vel.y * 0.32;
          f.vel.x *= 0.6;
          f.spin *= 0.5;
          const at = m.position.clone();
          at.y -= W3.cargoH / 2;
          this.stage.particles.emit('debris', at, 5);
          this.stage.particles.emit('dust', at, 5);
        } else {
          f.settled = true;
          f.vel.set(0, 0, 0);
          m.rotation.z = Math.round(m.rotation.z / (Math.PI / 2)) * (Math.PI / 2);
        }
      }
    }
  }

  // ==========================================================================
  // Overlays and tests
  // ==========================================================================

  clientPointOf(
    target: { cargo: number } | { shelf: number; slot: number; slots: number } | { belt: true },
  ): ClientPoint | null {
    if (!this.mounted) return null;
    if ('cargo' in target) {
      const c = this.cargo[target.cargo];
      if (!c || !c.mesh.visible) return null;
      return this.stage.toClient(c.worldPosition());
    }
    if ('belt' in target) {
      // The belt surface in front of the live spot, pushed into the belt drop band if needed.
      const cv = this.conveyor;
      const p = this.stage.toClient(new THREE.Vector3(0, W3.beltH, cv.z + 0.3));
      const rect = this.stage.canvas.getBoundingClientRect();
      const minY = rect.top + rect.height * (BELT_ZONE_3D + 0.03);
      return { x: p.x, y: Math.max(p.y, minY) };
    }
    const shelf = this.rack.shelves[target.shelf];
    if (!shelf) return null;
    // The front of the slot on the drag plane: releasing a dragged package here drops it in this slot.
    const local = new THREE.Vector3(shelf.slotCentreX(target.slot, target.slots), shelf.cargoCentreY, W3.dragZ);
    return this.stage.toClient(this.rack.toWorld(local));
  }
}
