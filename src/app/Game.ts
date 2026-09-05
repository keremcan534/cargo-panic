/**
 * Gameplay controller. Owns the drag loop, the hazard grace timers and the
 * win/fail transitions - a straight port of the 2D scene's state machine onto
 * the 3D world and the DOM UI.
 *
 * Design rule enforced everywhere: nothing ever fails instantly. Imbalance,
 * overloading and crushing all raise a visible countdown first, and the player
 * can always pick cargo back up to fix it.
 */

import * as THREE from 'three';
import type { AppContext, Screen } from './Router';
import { GRACE_MS, W3, WIN_SETTLE_MS } from '../game/config';
import { getWave, prefetchWave } from '../game/levels/generator';
import { getLevel, TOTAL_LEVELS } from '../game/levels/levels';
import { PACKAGE_SPECS } from '../game/levels/types';
import type { LevelDef } from '../game/levels/types';
import { rejectionMessage } from '../game/systems/BalanceSystem';
import type { BoardEval } from '../game/systems/BalanceSystem';
import { audio } from '../game/systems/AudioManager';
import { haptics } from '../game/systems/Haptics';
import { HazardSystem } from '../game/systems/HazardSystem';
import { requestHint } from '../game/systems/HintService';
import { PlacementSystem } from '../game/systems/PlacementSystem';
import { progress } from '../game/systems/ProgressManager';
import { formatScore, newRun, scoreWave } from '../game/systems/RunManager';
import type { RunState } from '../game/systems/RunManager';
import { hintFor } from '../game/systems/Solver';
import { Easing } from '../render/Tween';
import { Warehouse } from '../render/Warehouse';
import { Hud } from '../ui/Hud';
import { levelSelectScreen } from '../ui/LevelSelect';
import { menuScreen } from '../ui/Menu';
import { Meter } from '../ui/Meter';
import {
  FailPanel,
  LegendPanel,
  PausePanel,
  RunOverPanel,
  TipCard,
  WaveClearCard,
  WinPanel,
} from '../ui/Panels';
import type { FailReason } from '../ui/Panels';
import { btn, el, fadeIn, fadeOut, iconBtn, uiRoot } from '../ui/dom';
import { Cargo3D } from '../world/Cargo3D';
import { Conveyor3D } from '../world/Conveyor3D';
import { Rack3D } from '../world/Rack3D';
import type { GhostKind } from '../world/Rack3D';

export interface GameData {
  levelId?: number;
  run?: RunState;
}

type Phase = 'play' | 'paused' | 'resolving';

interface DropTarget {
  shelf: number;
  slot: number;
  kind: GhostKind;
  reason: string;
}

interface Falling {
  cargo: Cargo3D;
  vel: THREE.Vector3;
  spin: number;
  settled: boolean;
}

/** Bottom fraction of the canvas that counts as "drop it back on the belt". */
const BELT_ZONE = 0.76;

export function gameScreen(ctx: AppContext, data: GameData): Screen {
  return new GameController(ctx, data);
}

class GameController implements Screen {
  private level: LevelDef;
  private run: RunState | null;
  private graceScale: number;

  private warehouse!: Warehouse;
  private rack!: Rack3D;
  private conveyor!: Conveyor3D;
  private hud!: Hud;
  private meter!: Meter;
  private board: PlacementSystem;
  private hazards: HazardSystem;

  private cargo: Cargo3D[] = [];
  private queue: number[] = [];
  private evalCache!: BoardEval;
  private canFinish = false;

  private phase: Phase = 'play';
  private dragged: Cargo3D | null = null;
  private dragGrab = new THREE.Vector3();
  private pointerClient = { x: 0, y: 0 };
  private dragLift = 0;
  private dragLiftTarget = 0;
  private dragZ: number = W3.dragZ;
  private dragOrigin: { shelf: number; slot: number } | null = null;
  private target: DropTarget | null = null;
  private overBelt = false;
  private beltZone!: HTMLElement;
  private dangerEl!: HTMLElement;

  private creakAccum = 0;
  private beepAccum = 0;
  private beepStep = 0;
  private winAccum = 0;
  private mistakes = 0;
  private hintUsed = false;
  private hintTimer = 0;
  private tip?: TipCard;
  private waveCard?: WaveClearCard;
  private advancing = false;
  private falling: Falling[] = [];
  private timers: number[] = [];
  private offFrame?: () => void;
  private controls!: HTMLElement;

  constructor(
    private ctx: AppContext,
    data: GameData,
  ) {
    this.run = data.run ?? null;
    if (this.run) {
      const plan = getWave(this.run.seed, this.run.wave);
      this.level = plan.level;
      this.graceScale = plan.graceScale;
    } else {
      this.level = getLevel(data.levelId ?? 1);
      this.graceScale = 1;
    }
    this.board = new PlacementSystem(this.level);
    this.hazards = new HazardSystem(this.level, this.graceScale);
  }

  private get r() {
    return this.ctx.renderer;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  enter() {
    const r = this.r;
    const tiers = this.level.shelves.length;
    const maxSlots = Math.max(...this.level.shelves.map((s) => s.slots));
    r.frame(tiers, maxSlots);

    this.rack = new Rack3D(r.tweens, this.level, r.scene);
    this.warehouse = new Warehouse({ rackHalfWidth: this.rack.halfWidth });
    r.scene.add(this.warehouse.group);
    this.conveyor = new Conveyor3D(r.scene, this.rack.halfWidth);

    this.meter = new Meter(this.level.balanceTolerance);
    this.hud = new Hud(
      this.run
        ? {
            title: `WAVE ${this.run.wave}`,
            subtitle: formatScore(this.run.score),
            subtitleGold: true,
            objective: this.level.objective,
            showRestart: false,
          }
        : {
            title: `LEVEL ${this.level.id}`,
            subtitle: this.level.name,
            objective: this.level.objective,
            showRestart: true,
          },
      { onRestart: () => this.restartLevel(), onPause: () => this.openPause() },
    );

    const hint = btn('HINT', () => this.onHint(), 'gold', 'sm');
    hint.dataset.role = 'hint';
    this.controls = el('div', { class: 'controls' }, [
      iconBtn('help', () => this.openLegend(), 'Cargo guide'),
      el('div', { class: 'hint-text', text: 'Drag cargo onto a shelf.\nTap a stowed box to move it.' }),
      hint,
    ]);
    this.controls.querySelector('.hint-text')!.setAttribute('style', 'white-space: pre-line');
    this.beltZone = el('div', { class: 'belt-zone' }, [el('span', { text: 'BACK ON THE BELT' })]);
    this.dangerEl = el('div', { id: 'danger' });
    uiRoot().append(this.dangerEl, this.beltZone, this.controls);

    for (let id = 0; id < this.level.packages.length; id++) {
      const c = new Cargo3D(r.tweens, id, this.level.packages[id]);
      c.mesh.visible = false;
      r.scene.add(c.mesh);
      this.cargo.push(c);
      this.queue.push(id);
    }
    this.refreshQueue(true);
    this.refreshBoard();

    if (this.run) {
      this.tip = new TipCard(this.waveIntro());
      const run = this.run;
      this.after(120, () => prefetchWave(run.seed, run.wave + 1));
    } else if (this.level.tip) {
      this.tip = new TipCard(this.level.tip);
    }

    const canvas = r.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('blur', this.onPointerCancel);

    this.offFrame = r.onFrame((dt) => this.update(dt));
    fadeIn();
  }

  exit() {
    const canvas = this.r.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    window.removeEventListener('blur', this.onPointerCancel);
    this.offFrame?.();
    for (const t of this.timers) clearTimeout(t);
    clearTimeout(this.hintTimer);
    this.tip?.dismiss();
    this.waveCard?.dismiss();
    for (const c of this.cargo) c.dispose();
    this.cargo = [];
    this.rack.dispose();
    this.conveyor.dispose();
    this.warehouse.dispose();
    this.hud.destroy();
    this.meter.destroy();
    this.controls.remove();
    this.beltZone.remove();
    this.dangerEl.remove();
    this.r.scene.remove(...this.r.scene.children.filter((o) => !(o instanceof THREE.Points)));
  }

  private after(ms: number, fn: () => void) {
    const t = window.setTimeout(fn, ms);
    this.timers.push(t);
    return t;
  }

  private goto(factory: Parameters<AppContext['router']['go']>[0]) {
    void fadeOut(200).then(() => this.ctx.router.go(factory));
  }

  private restartLevel() {
    const id = this.level.id;
    this.goto((c) => gameScreen(c, { levelId: id }));
  }

  // ==========================================================================
  // Queue
  // ==========================================================================

  private refreshQueue(instant = false) {
    const cv = this.conveyor;
    for (const c of this.cargo) {
      if (c.state === 'placed' || c === this.dragged || c.state === 'falling') continue;
      const qi = this.queue.indexOf(c.id);
      if (qi < 0) {
        c.mesh.visible = false;
        continue;
      }
      const tw = this.r.tweens;
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

  // ==========================================================================
  // Dragging
  // ==========================================================================

  private onPointerDown = (e: PointerEvent) => {
    if (this.phase !== 'play' || this.dragged) return;
    audio.unlock();
    const candidates: THREE.Object3D[] = [];
    const cur = this.queue[0] !== undefined ? this.cargo[this.queue[0]] : null;
    if (cur && cur.state === 'queued') candidates.push(cur.mesh);
    for (const c of this.placedCargo()) candidates.push(c.mesh);
    const hit = this.r.pick(e.clientX, e.clientY, candidates);
    if (!hit) return;
    const cargo = this.cargo[hit.userData.cargoId as number];
    if (cargo) {
      this.r.domElement.setPointerCapture(e.pointerId);
      this.beginDrag(cargo, e);
    }
  };

  private beginDrag(c: Cargo3D, e: PointerEvent) {
    this.clearHint();
    this.tip?.dismiss();
    this.dragged = c;
    const wasPlaced = c.state === 'placed';
    c.state = 'dragging';
    c.mesh.visible = true;
    c.setOpacity(1);

    if (wasPlaced) {
      this.dragOrigin = { shelf: c.shelf, slot: c.slot };
      this.board.remove(c.id);
      this.rack.detach(c, this.r.scene);
      this.r.tweens.add(c.mesh.rotation, { z: 0 }, { ms: 140 });
      this.refreshBoard();
    } else {
      this.dragOrigin = null;
      this.queue.shift();
      this.refreshQueue();
    }
    this.r.tweens.kill(c.mesh.position);
    c.setDragging(true);

    this.pointerClient = { x: e.clientX, y: e.clientY };
    this.dragLift = 0;
    this.dragLiftTarget = e.pointerType === 'touch' ? W3.touchLift : 0;
    // Start the drag plane where the cargo is, then ease it in to the shelves.
    this.dragZ = c.mesh.position.z;
    const p = this.r.pointerOnPlane(e.clientX, e.clientY, this.dragZ);
    if (p) {
      this.dragGrab.set(c.mesh.position.x - p.x, c.mesh.position.y - p.y, 0);
      if (Math.abs(this.dragGrab.x) > c.width * 0.4) this.dragGrab.x = 0;
      this.dragGrab.y = Math.max(-W3.cargoH * 0.5, Math.min(W3.cargoH * 0.5, this.dragGrab.y));
    } else {
      this.dragGrab.set(0, 0, 0);
    }

    this.conveyor.setDragging(true);
    this.rack.updateCrushColumns(this.placedCargo(), PlacementSystem.isCrusher(c.type));
    audio.pickup();
    haptics.tap();
  }

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragged) return;
    this.pointerClient = { x: e.clientX, y: e.clientY };
  };

  private updateDrag(dt: number) {
    const c = this.dragged;
    if (!c) return;
    const k = 1 - Math.pow(0.0004, dt / 1000);
    this.dragLift += (this.dragLiftTarget - this.dragLift) * k;
    this.dragZ += (W3.dragZ - this.dragZ) * k;

    const p = this.r.pointerOnPlane(this.pointerClient.x, this.pointerClient.y, this.dragZ);
    if (!p) return;
    c.mesh.position.set(p.x + this.dragGrab.x, p.y + this.dragGrab.y + this.dragLift, this.dragZ);
    this.updateTarget();
  }

  private updateTarget() {
    const c = this.dragged;
    if (!c) return;

    const rect = this.r.domElement.getBoundingClientRect();
    const fy = (this.pointerClient.y - rect.top) / rect.height;
    if (fy > BELT_ZONE) {
      this.target = null;
      this.rack.hideGhost();
      this.meter.hidePreview();
      this.setOverBelt(true);
      return;
    }
    this.setOverBelt(false);

    const local = this.rack.toLocal(c.mesh.position);
    const tier = this.rack.nearestShelf(local.x, local.y);
    if (tier < 0) {
      this.target = null;
      this.rack.hideGhost();
      this.meter.hidePreview();
      return;
    }
    const shelf = this.rack.shelves[tier];
    const slot = shelf.slotFromX(local.x, c.slots);
    const rejection = this.board.check(c.type, tier, slot, c.id);
    if (rejection) {
      this.target = { shelf: tier, slot, kind: 'bad', reason: rejectionMessage(rejection) };
      this.rack.showGhost(tier, slot, c.slots, 'bad');
      this.meter.hidePreview();
      return;
    }
    const preview = this.board.previewEval(c.type, tier, slot, c.id);
    const willCrush = preview.crushed.length > 0;
    const willOverload = preview.overloaded.includes(tier);
    const kind: GhostKind = willCrush || willOverload ? 'crush' : 'ok';
    const reason = willCrush ? 'CRUSHES FRAGILE CARGO' : willOverload ? 'OVER LOAD LIMIT' : '';
    this.target = { shelf: tier, slot, kind, reason };
    this.rack.showGhost(tier, slot, c.slots, kind);
    this.meter.showPreview(preview.net);
  }

  private setOverBelt(on: boolean) {
    if (on === this.overBelt) return;
    this.overBelt = on;
    this.beltZone.classList.toggle('on', on);
  }

  private onPointerUp = () => {
    const c = this.dragged;
    if (!c) return;
    const overBelt = this.overBelt;
    this.dragged = null;
    this.conveyor.setDragging(false);
    this.rack.hideGhost();
    this.meter.hidePreview();
    this.setOverBelt(false);
    c.setDragging(false);
    const target = this.target;
    this.target = null;

    if (target && target.kind !== 'bad') {
      this.commitPlacement(c, target.shelf, target.slot);
      return;
    }
    if (target && target.kind === 'bad') {
      this.mistakes++;
      this.hud.toast(target.reason);
      audio.invalid();
      haptics.reject();
    }
    this.returnCargo(c, overBelt);
  };

  private onPointerCancel = () => {
    const c = this.dragged;
    if (!c) return;
    this.dragged = null;
    this.target = null;
    this.conveyor.setDragging(false);
    this.rack.hideGhost();
    this.meter.hidePreview();
    this.setOverBelt(false);
    c.setDragging(false);
    this.returnCargo(c, false);
  };

  /** Back to its shelf if it came off one, otherwise the front of the belt. */
  private returnCargo(c: Cargo3D, forceToBelt: boolean) {
    const origin = this.dragOrigin;
    this.dragOrigin = null;
    if (origin && !forceToBelt) {
      if (!this.board.check(c.type, origin.shelf, origin.slot, c.id)) {
        this.commitPlacement(c, origin.shelf, origin.slot, true);
        return;
      }
    }
    c.state = 'queued';
    c.shelf = -1;
    c.slot = -1;
    c.setCracking(false);
    c.setHinted(false);
    this.queue.unshift(c.id);
    if (forceToBelt && origin) this.hud.toast('BACK ON THE BELT', 'info');

    const cv = this.conveyor;
    this.r.tweens.kill(c.mesh.position);
    this.r.tweens.add(c.mesh.position, { x: cv.liveX, y: cv.cargoY, z: cv.z }, {
      ms: 260,
      ease: Easing.backOut,
      onDone: () => this.refreshQueue(true),
    });
    this.r.tweens.add(c.mesh.rotation, { z: 0 }, { ms: 200 });
    this.refreshQueue();
    this.refreshBoard();
  }

  private commitPlacement(c: Cargo3D, tier: number, slot: number, quiet = false) {
    const shelf = this.rack.shelves[tier];
    this.rack.attach(c);
    c.state = 'placed';
    c.shelf = tier;
    c.slot = slot;
    this.board.place(c.id, c.type, tier, slot);
    this.dragOrigin = null;

    const tx = shelf.slotCentreX(slot, c.slots);
    const ty = shelf.cargoCentreY;
    const dist = Math.hypot(c.mesh.position.x - tx, c.mesh.position.y - ty, c.mesh.position.z);
    const ms = quiet ? 140 : Math.max(130, Math.min(300, 90 + dist * 60));
    this.r.tweens.kill(c.mesh.position);
    this.r.tweens.add(c.mesh.position, { x: tx, y: ty, z: 0.02 }, {
      ms,
      ease: quiet ? Easing.quadOut : Easing.backIn,
      onDone: () => this.onLanded(c, tier, quiet),
    });
    this.r.tweens.add(c.mesh.rotation, { x: 0, y: 0, z: 0 }, { ms });
    this.refreshBoard();
    this.refreshQueue();
  }

  private onLanded(c: Cargo3D, tier: number, quiet: boolean) {
    const shelf = this.rack.shelves[tier];
    c.landBounce(c.weight);
    shelf.flex(c.weight);
    if (!quiet) {
      const at = c.worldPosition();
      at.y -= W3.cargoH / 2;
      at.z += W3.cargoD / 2;
      this.r.particles.emit('dust', at, 5 + c.weight);
      if (c.type === 'heavy') {
        audio.placeHeavy();
        haptics.thud();
        this.r.shake(0.06, 160);
        this.r.particles.emit('spark', at, 6, 0xf0a53c);
      } else if (c.type === 'fragile') {
        audio.placeFragile();
        haptics.place();
      } else {
        audio.place(c.weight);
        haptics.place();
      }
    }
    this.refreshBoard();
  }

  // ==========================================================================
  // Board state
  // ==========================================================================

  private refreshBoard() {
    const ev = this.board.evaluate();
    this.evalCache = ev;
    this.meter.setValue(ev.net, ev.leftTorque, ev.rightTorque, ev.status);
    this.rack.setBalance(ev.net, this.level.balanceTolerance, ev.status === 'danger');
    for (const s of this.rack.shelves) {
      s.setLoad(ev.shelfWeights[s.tier]);
      s.setOverloaded(ev.overloaded.includes(s.tier));
    }
    for (const c of this.cargo) if (c.type === 'fragile') c.setCracking(ev.crushed.includes(c.id));
    this.rack.updateCrushColumns(this.placedCargo(), !!this.dragged && PlacementSystem.isCrusher(this.dragged.type));
    const left = this.level.packages.length - this.board.count;
    this.hud.setRemaining(left, this.level.packages.length);
    const blocker = this.blockingReason(ev);
    this.canFinish = left === 0 && blocker === null;
    this.hud.setObjective(blocker ?? this.level.objective);
  }

  private blockingReason(ev: BoardEval): string | null {
    if (this.board.count < this.level.packages.length) return null;
    if (ev.overloaded.length > 0) return 'A SHELF IS OVER ITS LOAD LIMIT';
    if (ev.crushed.length > 0) return 'FRAGILE CARGO IS BEING CRUSHED';
    if (!ev.prioritySatisfied) return 'PRIORITY CARGO MUST SIT IN THE GOLD ZONE';
    const limit = this.level.finalBalanceMax ?? this.level.balanceTolerance;
    if (ev.imbalance > limit) return `IMBALANCE MUST DROP BELOW ${limit.toFixed(1)}`;
    return null;
  }

  // ==========================================================================
  // Per-frame
  // ==========================================================================

  private update(dt: number) {
    this.rack.tick(dt);
    this.meter.tick(dt);
    this.conveyor.tick(dt);
    this.warehouse.tick(dt);
    if (this.dragged) this.updateDrag(dt);
    this.updateFalling(dt);
    if (this.phase !== 'play') return;

    const hazard = this.hazards.update(this.evalCache, dt);
    if (hazard.kind) {
      this.winAccum = 0;
      this.tip?.dismiss();
      this.hud.showHazard(hazard.kind, hazard.remaining, hazard.total);
      this.dangerEl.classList.add('on');
      this.runHazardAudio(dt, hazard.urgency);
      if (hazard.expired) {
        this.failLevel(
          hazard.kind === 'balance' ? 'collapse' : hazard.kind === 'overload' ? 'overload' : 'fragile',
          hazard.owner,
        );
      }
      return;
    }
    this.creakAccum = 0;
    this.beepAccum = 0;
    this.beepStep = 0;
    this.hud.hideHazard();
    this.dangerEl.classList.remove('on');

    if (this.canFinish) {
      this.winAccum += dt;
      if (this.winAccum >= WIN_SETTLE_MS) this.winLevel();
    } else {
      this.winAccum = 0;
    }
  }

  private runHazardAudio(dt: number, urgency: number) {
    this.creakAccum += dt;
    if (this.creakAccum > 620) {
      this.creakAccum = 0;
      audio.creak(urgency);
    }
    this.beepAccum += dt;
    if (this.beepAccum > 620 - urgency * 380) {
      this.beepAccum = 0;
      audio.warn(this.beepStep++);
      if (urgency > 0.5) haptics.warn();
    }
  }

  /** Cargo knocked off the rack: a tiny deterministic tumble, no physics engine. */
  private updateFalling(dt: number) {
    const s = dt / 1000;
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
          this.r.particles.emit('debris', at, 5);
          this.r.particles.emit('dust', at, 5);
        } else {
          f.settled = true;
          f.vel.set(0, 0, 0);
          m.rotation.z = Math.round(m.rotation.z / (Math.PI / 2)) * (Math.PI / 2);
        }
      }
    }
  }

  // ==========================================================================
  // Hint
  // ==========================================================================

  private onHint() {
    if (this.phase !== 'play' || this.dragged) return;
    if (this.queue.length === 0) {
      this.hud.toast('EVERYTHING IS STOWED - FIX THE BALANCE', 'info');
      return;
    }
    requestHint(() => this.applyHint());
  }

  private applyHint() {
    const currentId = this.queue[0];
    const hint = hintFor(this.level, this.board.list, this.queue.slice(), currentId);
    if (hint.kind === 'stuck') {
      this.hud.toast('NO SOLUTION FROM HERE - TAP RESTART', 'info');
      return;
    }
    this.hintUsed = true;
    this.clearHint();
    const c = this.cargo[currentId];
    c.setHinted(true);
    this.rack.showGhost(hint.shelf, hint.slot, c.slots, 'ok');
    if (hint.kind === 'rearrange') this.hud.toast('SOME STOWED CARGO NEEDS MOVING TOO', 'info');
    this.hintTimer = window.setTimeout(() => this.clearHint(), 4200);
  }

  private clearHint() {
    clearTimeout(this.hintTimer);
    for (const c of this.cargo) c.setHinted(false);
    if (!this.dragged) this.rack.hideGhost();
  }

  // ==========================================================================
  // Resolution
  // ==========================================================================

  private winLevel() {
    if (this.run) {
      this.clearWave();
      return;
    }
    this.phase = 'resolving';
    this.clearHint();
    this.hud.hideHazard();
    this.dangerEl.classList.remove('on');

    const ev = this.evalCache;
    const limit = this.level.finalBalanceMax ?? this.level.balanceTolerance;
    let stars = 3;
    if (this.hintUsed || this.mistakes > 0 || ev.imbalance > limit * 0.4) stars = 2;
    if (this.mistakes >= 3) stars = 1;

    const previousBest = progress.bestBalanceFor(this.level.id);
    const record = progress.recordWin(this.level.id, stars, ev.imbalance);

    audio.win();
    haptics.win();
    this.celebrate();
    this.rack.celebrate();

    const id = this.level.id;
    this.after(520, () => {
      new WinPanel(
        {
          levelId: id,
          stars,
          imbalance: ev.imbalance,
          tolerance: limit,
          packages: this.level.packages.length,
          mistakes: this.mistakes,
          hintUsed: this.hintUsed,
          isLastLevel: id >= TOTAL_LEVELS,
          newBest: record.balanceImproved && previousBest !== null,
          firstClear: previousBest === null,
        },
        {
          onNext: () => this.goto((c) => gameScreen(c, { levelId: id + 1 })),
          onRetry: () => this.restartLevel(),
          onLevels: () => this.goto(levelSelectScreen),
        },
      );
    });
  }

  private celebrate() {
    const at = new THREE.Vector3(0, this.rack.topY + 0.5, 1);
    const p = this.r.particles;
    p.emit('confetti', at, 46);
    this.after(220, () => p.emit('confetti', new THREE.Vector3(-2, this.rack.topY, 1), 26));
    this.after(400, () => p.emit('confetti', new THREE.Vector3(2, this.rack.topY, 1), 26));
  }

  private failLevel(reason: FailReason, owner: number) {
    this.phase = 'resolving';
    this.clearHint();
    this.hud.hideHazard();
    this.dangerEl.classList.remove('on');
    const ev = this.evalCache;
    let detail = '';

    if (reason === 'collapse') {
      const dir = ev.net >= 0 ? 1 : -1;
      detail = `Imbalance reached ${ev.imbalance.toFixed(1)} against a limit of ${this.level.balanceTolerance.toFixed(1)}.`;
      audio.collapse();
      haptics.crash();
      this.r.shake(0.32, 620);
      this.flash();
      this.rack.collapse(dir, () => undefined);
      this.after(180, () => this.spillCargo(this.placedCargo(), dir));
    } else if (reason === 'overload') {
      const shelf = this.rack.shelves[owner];
      detail = `Tier ${owner + 1} carried ${ev.shelfWeights[owner]} against a rating of ${shelf.def.maxWeight}.`;
      audio.collapse();
      haptics.crash();
      this.r.shake(0.22, 480);
      const victims = this.placedCargo().filter((c) => c.shelf <= owner);
      this.after(120, () => this.spillCargo(victims, ev.net >= 0 ? 1 : -1));
    } else {
      const c = this.cargo[owner];
      detail = 'A heavy crate was stacked in the column above the glass.';
      audio.shatter();
      haptics.crash();
      this.r.shake(0.16, 320);
      if (c && c.state === 'placed') {
        this.r.particles.emit('glass', c.worldPosition(), 26);
        this.r.tweens.add(c.mesh.scale, { x: 1.25, y: 0.7 }, { ms: 220 });
        const fade = { v: 1 };
        this.r.tweens.add(fade, { v: 0 }, { ms: 220, onUpdate: () => c.setOpacity(fade.v) });
      }
    }

    audio.fail();
    const delay = reason === 'fragile' ? 900 : 1500;

    if (this.run) {
      const run = this.run;
      const newBest = progress.recordRun(run.score, run.wave);
      const stats = progress.endless;
      this.after(delay, () => {
        new RunOverPanel(
          {
            seed: run.seed,
            wave: run.wave,
            score: run.score,
            stowed: run.stowed,
            cleanWaves: run.cleanWaves,
            bestScore: stats.bestScore,
            bestWave: stats.bestWave,
            newBest,
            reason,
          },
          {
            onRetry: () => this.goto((c) => gameScreen(c, { run: newRun() })),
            onMenu: () => this.goto(menuScreen),
          },
        );
      });
      return;
    }
    this.after(delay, () => {
      new FailPanel(reason, detail, {
        onRetry: () => this.restartLevel(),
        onLevels: () => this.goto(levelSelectScreen),
      });
    });
  }

  private flash() {
    const f = document.getElementById('flash');
    if (!f) return;
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  /** Deterministic per package id - a replay of the same board looks the same. */
  private spillCargo(victims: Cargo3D[], dir: number) {
    victims.forEach((c, i) => {
      this.rack.detach(c, this.r.scene);
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

  // ==========================================================================
  // Endless
  // ==========================================================================

  private waveIntro(): string {
    const run = this.run;
    if (!run) return '';
    const notes: Record<number, string> = {
      1: 'Endless shift. Clear a shipment, the next one is harder.',
      2: 'Heavy crates from here on.',
      4: 'Fragile cargo joins the belt.',
      6: 'Long packages joins the manifest.',
      9: 'Priority cargo - gold zone only.',
      12: 'Aisles can be sealed off from now on.',
    };
    const note = notes[run.wave];
    const grace = (GRACE_MS.balance * this.graceScale) / 1000;
    const stats =
      `${this.level.packages.length} packages - ${this.level.shelves.length} tiers - ` +
      `red line ${this.level.balanceTolerance.toFixed(1)}` +
      (this.graceScale < 0.99 ? ` - ${grace.toFixed(1)}s to fix a mistake` : '');
    return note ? `${note}\n${stats}` : stats;
  }

  private clearWave() {
    const run = this.run;
    if (!run) return;
    this.phase = 'resolving';
    this.clearHint();
    this.hud.hideHazard();
    this.dangerEl.classList.remove('on');
    this.tip?.dismiss();

    const ev = this.evalCache;
    const weight = this.level.packages.reduce((n, t) => n + PACKAGE_SPECS[t].weight, 0);
    const result = scoreWave({
      wave: run.wave,
      manifestWeight: weight,
      imbalance: ev.imbalance,
      tolerance: this.level.balanceTolerance,
      mistakes: this.mistakes,
      hintUsed: this.hintUsed,
    });
    run.score += result.total;
    run.stowed += this.level.packages.length;
    if (result.clean) run.cleanWaves++;

    audio.win();
    haptics.win();
    this.hud.setSubtitle(formatScore(run.score));
    this.hud.pulseSubtitle();
    this.celebrate();
    this.rack.celebrate();
    this.dispatchCargo();
    this.waveCard = new WaveClearCard(result);

    this.after(700, () => {
      if (this.phase === 'resolving') {
        this.r.domElement.addEventListener('pointerdown', () => this.advanceWave(), { once: true });
      }
    });
    this.after(2400, () => this.advanceWave());
  }

  /** Cargo rides off to the right, like a truck taking the load. */
  private dispatchCargo() {
    const packages = this.placedCargo().sort((a, b) => a.mesh.position.x - b.mesh.position.x);
    this.board.clear();
    packages.forEach((c, i) => {
      this.rack.detach(c, this.r.scene);
      c.setCracking(false);
      c.state = 'falling';
      c.shelf = -1;
      c.slot = -1;
      const at = c.worldPosition();
      const fade = { v: 1 };
      this.r.tweens.add(c.mesh.position, { x: at.x + 14, y: at.y + 0.3 }, {
        ms: 540,
        delay: i * 55,
        ease: Easing.backIn,
      });
      this.r.tweens.add(fade, { v: 0 }, {
        ms: 540,
        delay: i * 55,
        ease: Easing.quadIn,
        onUpdate: () => c.setOpacity(fade.v),
      });
      this.after(i * 55, () => {
        const dust = c.worldPosition();
        dust.y -= W3.cargoH / 2;
        this.r.particles.emit('dust', dust, 4);
        audio.pickup();
      });
    });
    this.refreshBoard();
    this.hud.setRemaining(0, this.level.packages.length);
  }

  private advanceWave() {
    const run = this.run;
    if (!run || this.advancing) return;
    this.advancing = true;
    this.waveCard?.dismiss();
    run.wave++;
    this.goto((c) => gameScreen(c, { run }));
  }

  // ==========================================================================
  // Menus
  // ==========================================================================

  private openLegend() {
    if (this.phase !== 'play') return;
    this.onPointerCancel();
    this.phase = 'paused';
    new LegendPanel(() => {
      this.phase = 'play';
    });
  }

  private openPause() {
    if (this.phase !== 'play') return;
    this.onPointerCancel();
    this.phase = 'paused';
    new PausePanel({
      soundOn: progress.soundOn,
      hapticsOn: progress.hapticsOn,
      onToggleSound: () => {
        const on = !progress.soundOn;
        audio.setEnabled(on);
        return on;
      },
      onToggleHaptics: () => {
        const on = !progress.hapticsOn;
        haptics.setEnabled(on);
        return on;
      },
      onResume: () => {
        this.phase = 'play';
      },
      restartLabel: this.run ? 'END RUN' : 'RESTART LEVEL',
      exitLabel: this.run ? 'MAIN MENU' : 'LEVEL SELECT',
      onRestart: () => (this.run ? this.goto(menuScreen) : this.restartLevel()),
      onExit: () => this.goto(this.run ? menuScreen : levelSelectScreen),
    });
  }
}
