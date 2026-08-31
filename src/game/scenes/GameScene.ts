/**
 * Gameplay. Owns the drag loop, the hazard grace timers, and the win/fail
 * transitions.
 *
 * Design rule this scene enforces everywhere: nothing ever fails instantly.
 * Imbalance, overloading and crushing all raise a visible banner with a
 * countdown first, and the player can always pick cargo back up to fix it.
 */

import Phaser from 'phaser';
import { COLORS, FONT, GRACE_MS, HEX, PKG_H, TOUCH_LIFT, WIN_SETTLE_MS } from '../config';
import { computeLayout } from '../layout';
import type { Layout } from '../layout';
import { Conveyor, PREVIEW_SCALE } from '../entities/Conveyor';
import { CargoPackage } from '../entities/Package';
import { Rack } from '../entities/Rack';
import { getLevel, TOTAL_LEVELS } from '../levels/levels';
import { getWave, prefetchWave } from '../levels/generator';
import { PACKAGE_SPECS } from '../levels/types';
import type { LevelDef } from '../levels/types';
import { rejectionMessage } from '../systems/BalanceSystem';
import type { BoardEval } from '../systems/BalanceSystem';
import { audio } from '../systems/AudioManager';
import { EffectsManager } from '../systems/EffectsManager';
import { haptics } from '../systems/Haptics';
import { HazardSystem } from '../systems/HazardSystem';
import { requestHint } from '../systems/HintService';
import { PlacementSystem } from '../systems/PlacementSystem';
import { progress } from '../systems/ProgressManager';
import { formatScore, newRun, scoreWave } from '../systems/RunManager';
import type { RunState } from '../systems/RunManager';
import { hintFor } from '../systems/Solver';
import { drawBackdrop } from '../ui/Backdrop';
import { BalanceMeter } from '../ui/BalanceMeter';
import { Button, IconButton } from '../ui/Button';
import { Hud } from '../ui/Hud';
import {
  FailPanel,
  LegendPanel,
  PausePanel,
  RunOverPanel,
  WaveClearCard,
  WinPanel,
} from '../ui/Panels';
import type { FailReason } from '../ui/Panels';

type Phase = 'play' | 'paused' | 'resolving';

interface DropTarget {
  shelf: number;
  slot: number;
  kind: 'ok' | 'bad' | 'crush';
  reason: string;
}

export interface GameSceneData {
  /** Campaign: the level to load. */
  levelId?: number;
  /** Endless: the run to continue. Takes precedence over levelId. */
  run?: RunState;
}

export class GameScene extends Phaser.Scene {
  private level!: LevelDef;
  private layout!: Layout;
  /** Non-null in Endless mode. */
  private run: RunState | null = null;
  private graceScale = 1;
  private waveCard?: WaveClearCard;
  private advancing = false;

  private rack!: Rack;
  private conveyor!: Conveyor;
  private hud!: Hud;
  private meter!: BalanceMeter;
  private fx!: EffectsManager;
  private board!: PlacementSystem;

  private packages: CargoPackage[] = [];
  private queue: number[] = [];
  /** Last board evaluation. Recomputed only when the board actually changes. */
  private evalCache!: BoardEval;
  /** Everything is stowed and legal - the level just has to settle. */
  private canFinish = false;

  private phase: Phase = 'play';
  private dragged: CargoPackage | null = null;
  private dragGrab = new Phaser.Math.Vector2();
  private dragPointer = new Phaser.Math.Vector2();
  private dragLift = 0;
  private dragLiftTarget = 0;
  private dragOrigin: { shelf: number; slot: number } | null = null;
  private target: DropTarget | null = null;
  private beltDropActive = false;
  private beltHighlight!: Phaser.GameObjects.Graphics;

  private hazards!: HazardSystem;
  private creakAccum = 0;
  private beepAccum = 0;
  private beepStep = 0;
  private winAccum = 0;

  private mistakes = 0;
  private hintUsed = false;
  private hintTimer?: Phaser.Time.TimerEvent;
  private hintButton!: Button;
  private tipCard?: Phaser.GameObjects.Container;

  constructor() {
    super('Game');
  }

  init(data: GameSceneData) {
    this.run = data?.run ?? null;
    if (this.run) {
      // Deterministic from (seed, wave), and usually already prefetched.
      const plan = getWave(this.run.seed, this.run.wave);
      this.level = plan.level;
      this.graceScale = plan.graceScale;
    } else {
      this.level = getLevel(data?.levelId ?? 1);
      this.graceScale = 1;
    }
    this.waveCard = undefined;
    this.advancing = false;
    this.packages = [];
    this.queue = [];
    this.phase = 'play';
    this.dragged = null;
    this.dragOrigin = null;
    this.target = null;
    this.beltDropActive = false;
    this.canFinish = false;
    this.hazards = new HazardSystem(this.level, this.graceScale);
    this.creakAccum = 0;
    this.beepAccum = 0;
    this.beepStep = 0;
    this.winAccum = 0;
    this.mistakes = 0;
    this.hintUsed = false;
  }

  create() {
    const h = this.scale.height;
    const maxSlots = Math.max(...this.level.shelves.map((s) => s.slots));
    this.layout = computeLayout(h, this.level.shelves.length, maxSlots);
    this.board = new PlacementSystem(this.level);
    this.hazards = new HazardSystem(this.level, this.graceScale);

    this.cameras.main.fadeIn(200, 13, 17, 23);
    drawBackdrop(this, this.layout.w, h, {
      floorY: this.layout.rackBaseY + 56 * this.layout.rackScale,
      silhouettes: true,
    });

    this.rack = new Rack(
      this,
      this.level,
      this.layout.w / 2,
      this.layout.rackBaseY,
      this.layout.rackScale,
    );
    this.rack.container.setDepth(10);

    this.conveyor = new Conveyor(this, this.layout);
    this.beltHighlight = this.add.graphics().setDepth(22);

    this.meter = new BalanceMeter(
      this,
      this.layout.w / 2,
      this.layout.meterY + 12,
      this.level.balanceTolerance,
    );
    this.meter.setDepth(40);

    this.hud = new Hud(
      this,
      this.layout,
      this.run
        ? {
            title: `WAVE ${this.run.wave}`,
            subtitle: formatScore(this.run.score),
            subtitleColor: HEX.gold,
            objective: this.level.objective,
            showRestart: false,
          }
        : {
            title: `LEVEL ${this.level.id}`,
            subtitle: this.level.name,
            objective: this.level.objective,
            showRestart: true,
          },
      {
        onRestart: () => this.restartLevel(),
        onPause: () => this.openPause(),
      },
    );

    this.fx = new EffectsManager(this, this.layout.w, h);

    this.hintButton = new Button(this, {
      x: this.layout.w - 116,
      y: this.layout.hintY,
      width: 196,
      height: 62,
      label: 'HINT',
      style: 'gold',
      fontSize: 26,
      onClick: () => this.onHint(),
    });
    this.hintButton.setDepth(40);

    new IconButton(this, 52, this.layout.hintY, 50, 'help', () => this.openLegend()).setDepth(40);

    this.add
      .text(92, this.layout.hintY, 'Drag cargo onto a shelf.\nTap a stowed box to move it.', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#5c6d84',
        lineSpacing: 3,
      })
      .setOrigin(0, 0.5)
      .setDepth(40);

    this.buildPackages();
    this.refreshQueue(true);
    this.refreshBoard();

    if (this.run) {
      this.showTip(this.waveIntro());
      // Build the next wave while this one is being played, so the search
      // never costs the player a frame.
      this.time.delayedCall(120, () => {
        if (this.run) prefetchWave(this.run.seed, this.run.wave + 1);
      });
    } else if (this.level.tip) {
      this.showTip(this.level.tip);
    }

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    this.game.events.on(Phaser.Core.Events.BLUR, this.cancelDrag, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  private onShutdown() {
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    this.game.events.off(Phaser.Core.Events.BLUR, this.cancelDrag, this);
    this.hintTimer?.remove();
    this.hud.destroy();
    this.fx.destroy();
    for (const p of this.packages) p.destroy();
    this.packages = [];
  }

  // ==========================================================================
  // Setup
  // ==========================================================================

  private buildPackages() {
    this.level.packages.forEach((type, id) => {
      const pkg = new CargoPackage(this, id, type);
      pkg.view.setDepth(30).setVisible(false);
      this.packages.push(pkg);
      this.queue.push(id);
    });
  }

  /** Places the belt package, the two previews, and parks the rest. */
  private refreshQueue(instant = false) {
    const cy = this.conveyor.liveCentreY;

    this.packages.forEach((pkg) => {
      if (pkg.state === 'placed' || pkg === this.dragged) return;
      const qi = this.queue.indexOf(pkg.id);
      if (qi < 0) {
        pkg.view.setVisible(false);
        return;
      }

      if (qi === 0) {
        pkg.view.setVisible(true).setDepth(32);
        const from = instant ? this.conveyor.liveX : -160;
        if (instant) {
          pkg.view.setPosition(this.conveyor.liveX, cy).setScale(1).setAlpha(1);
        } else {
          pkg.view.setPosition(from, cy).setScale(1).setAlpha(1);
          this.tweens.add({
            targets: pkg.view,
            x: this.conveyor.liveX,
            duration: 320,
            ease: 'Back.easeOut',
          });
        }
      } else if (qi <= 2) {
        pkg.view.setVisible(true).setDepth(31);
        const tx = this.conveyor.previewX[qi - 1];
        const ty = this.conveyor.previewY;
        if (instant) {
          pkg.view.setPosition(tx, ty).setScale(PREVIEW_SCALE).setAlpha(0.92);
        } else {
          this.tweens.add({
            targets: pkg.view,
            x: tx,
            y: ty,
            scale: PREVIEW_SCALE,
            alpha: 0.92,
            duration: 280,
            ease: 'Quad.easeOut',
          });
        }
      } else {
        pkg.view.setVisible(false);
        pkg.view.setPosition(this.conveyor.previewX[1] + 120, this.conveyor.previewY);
        pkg.view.setScale(PREVIEW_SCALE).setAlpha(0);
      }
    });

    this.conveyor.setEmpty(this.queue.length === 0);
  }

  // ==========================================================================
  // Dragging
  // ==========================================================================

  /**
   * Which package, if any, is under the pointer. Hit testing is done by hand
   * rather than through Phaser input so the maths is identical whether a
   * package is sitting on the belt (scene space) or stowed in a rack that is
   * both scaled and tilted (rack space).
   */
  private pickAt(pointer: Phaser.Input.Pointer): CargoPackage | null {
    const px = pointer.worldX;
    const py = pointer.worldY;

    const currentId = this.queue[0];
    if (currentId !== undefined) {
      const cur = this.packages[currentId];
      if (
        cur.state === 'queued' &&
        Math.abs(px - cur.view.x) <= cur.grabHalfW &&
        Math.abs(py - cur.view.y) <= cur.grabHalfH
      ) {
        return cur;
      }
    }

    const local = this.rack.toLocal(px, py);
    let best: CargoPackage | null = null;
    for (const p of this.packages) {
      if (p.state !== 'placed') continue;
      if (Math.abs(local.x - p.view.x) > p.grabHalfW) continue;
      if (Math.abs(local.y - p.view.y) > p.grabHalfH) continue;
      // Prefer the upper tier when touch targets overlap between shelves.
      if (!best || p.shelf > best.shelf) best = p;
    }
    return best;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer) {
    if (this.phase !== 'play' || this.dragged) return;
    // Leave the HUD strip and the hint row to their buttons.
    if (pointer.worldY < this.layout.meterY + this.layout.meterH) return;
    if (pointer.worldY > this.layout.conveyorY + this.layout.conveyorH + 16) return;
    const pkg = this.pickAt(pointer);
    if (pkg) this.beginDrag(pkg, pointer);
  }

  private beginDrag(pkg: CargoPackage, pointer: Phaser.Input.Pointer) {
    if (this.phase !== 'play' || this.dragged) return;
    const isCurrent = this.queue[0] === pkg.id;
    if (!isCurrent && pkg.state !== 'placed') return;

    audio.unlock();
    this.clearHint();

    // Claim the package before touching the queue: refreshQueue() hides
    // anything that is neither placed nor queued nor in hand.
    this.dismissTip();
    this.dragged = pkg;
    const wasPlaced = pkg.state === 'placed';
    pkg.state = 'dragging';
    pkg.view.setVisible(true).setAlpha(1).setScale(1);

    if (wasPlaced) {
      this.dragOrigin = { shelf: pkg.shelf, slot: pkg.slot };
      this.board.remove(pkg.id);
      const world = this.rack.toScene(pkg.view.x, pkg.view.y);
      const rot = this.rack.container.rotation;
      this.rack.container.remove(pkg.view);
      this.add.existing(pkg.view);
      // Preserve apparent size when leaving the (possibly scaled) rack.
      pkg.view.setPosition(world.x, world.y).setRotation(rot).setScale(this.rack.scale);
      this.tweens.add({ targets: pkg.view, rotation: 0, duration: 140 });
      this.refreshBoard();
    } else {
      this.dragOrigin = null;
      this.queue.shift();
      this.refreshQueue();
    }

    pkg.view.setDepth(400);
    pkg.setDragging(true, this.rack.scale);

    // Touch pointers float the box above the finger so it stays visible. The
    // lift eases in during update() rather than teleporting on contact.
    this.dragLift = 0;
    this.dragLiftTarget = pointer.wasTouch ? TOUCH_LIFT : 0;
    this.dragPointer.set(pointer.worldX, pointer.worldY);
    this.dragGrab.set(pkg.view.x - pointer.worldX, pkg.view.y - pointer.worldY);
    // Very off-centre grabs feel worse than simply recentring.
    if (Math.abs(this.dragGrab.x) > pkg.width * 0.4) this.dragGrab.x = 0;
    this.dragGrab.y = Phaser.Math.Clamp(this.dragGrab.y, -PKG_H * 0.5, PKG_H * 0.5);

    pkg.view.setPosition(pkg.view.x, pkg.view.y);

    this.conveyor.setDragging(true);
    this.rack.updateCrushColumns(this.placedPackages(), PlacementSystem.isCrusher(pkg.type));
    audio.pickup();
    haptics.tap();
    this.updateTarget();
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (!this.dragged || this.phase !== 'play') return;
    this.dragPointer.set(pointer.worldX, pointer.worldY);
  }

  /** Cargo follows the pointer from update(), so the lift can ease in. */
  private updateDrag(deltaMs: number) {
    const pkg = this.dragged;
    if (!pkg) return;
    const k = 1 - Math.pow(0.0004, deltaMs / 1000);
    this.dragLift += (this.dragLiftTarget - this.dragLift) * k;
    pkg.view.setPosition(
      this.dragPointer.x + this.dragGrab.x,
      this.dragPointer.y + this.dragGrab.y - this.dragLift,
    );
    this.updateTarget();
  }

  private updateTarget() {
    const pkg = this.dragged;
    if (!pkg) return;

    const px = pkg.view.x;
    const py = pkg.view.y;

    // Dropping low returns cargo to the belt instead of the rack.
    const beltZone = py > this.layout.conveyorY - PKG_H - 24;
    if (beltZone) {
      this.target = null;
      this.rack.hideGhost();
      this.meter.hidePreview();
      this.setBeltHighlight(true);
      return;
    }
    this.setBeltHighlight(false);

    const local = this.rack.toLocal(px, py);
    const tier = this.rack.nearestShelf(local.x, local.y);
    if (tier < 0) {
      this.target = null;
      this.rack.hideGhost();
      this.meter.hidePreview();
      return;
    }

    const shelf = this.rack.shelves[tier];
    const slot = shelf.slotFromX(local.x, pkg.slots);
    const rejection = this.board.check(pkg.type, tier, slot, pkg.id);

    if (rejection) {
      this.target = { shelf: tier, slot, kind: 'bad', reason: rejectionMessage(rejection) };
      this.rack.showGhost(tier, slot, pkg.slots, 'bad');
      this.meter.hidePreview();
      return;
    }

    const preview = this.board.previewEval(pkg.type, tier, slot, pkg.id);
    const willCrush = preview.crushed.length > 0;
    const willOverload = preview.overloaded.includes(tier);
    const kind: DropTarget['kind'] = willCrush || willOverload ? 'crush' : 'ok';
    const reason = willCrush ? 'CRUSHES FRAGILE CARGO' : willOverload ? 'OVER LOAD LIMIT' : '';

    this.target = { shelf: tier, slot, kind, reason };
    this.rack.showGhost(tier, slot, pkg.slots, kind);
    this.meter.showPreview(preview.net);
  }

  private onPointerUp() {
    const pkg = this.dragged;
    if (!pkg) return;

    // Captured before the highlight is cleared: dropping low sends cargo back
    // to the belt instead of snapping it to wherever it came from.
    const overBelt = this.beltDropActive;

    this.dragged = null;
    this.conveyor.setDragging(false);
    this.rack.hideGhost();
    this.meter.hidePreview();
    this.setBeltHighlight(false);
    pkg.setDragging(false);

    const target = this.target;
    this.target = null;

    if (target && target.kind !== 'bad') {
      this.commitPlacement(pkg, target.shelf, target.slot);
      return;
    }

    if (target && target.kind === 'bad') {
      this.mistakes++;
      this.hud.toast(target.reason);
      audio.invalid();
      haptics.reject();
    }

    this.returnPackage(pkg, overBelt);
  }

  private cancelDrag() {
    const pkg = this.dragged;
    if (!pkg) return;
    this.dragged = null;
    this.target = null;
    this.conveyor.setDragging(false);
    this.rack.hideGhost();
    this.meter.hidePreview();
    this.setBeltHighlight(false);
    pkg.setDragging(false);
    this.returnPackage(pkg, false);
  }

  /**
   * Puts a package that was not placed somewhere sensible: back on its shelf
   * if it came off one, or onto the front of the belt queue.
   */
  private returnPackage(pkg: CargoPackage, forceToBelt: boolean) {
    const origin = this.dragOrigin;
    this.dragOrigin = null;

    if (origin && !forceToBelt) {
      const rejection = this.board.check(pkg.type, origin.shelf, origin.slot, pkg.id);
      if (!rejection) {
        this.commitPlacement(pkg, origin.shelf, origin.slot, true);
        return;
      }
    }

    pkg.state = 'queued';
    pkg.shelf = -1;
    pkg.slot = -1;
    pkg.setCracking(false);
    pkg.setHinted(false);
    this.queue.unshift(pkg.id);
    if (forceToBelt && origin) this.hud.toast('BACK ON THE BELT', 'info');

    const cy = this.conveyor.liveCentreY;
    pkg.view.setDepth(32);
    this.tweens.add({
      targets: pkg.view,
      x: this.conveyor.liveX,
      y: cy,
      scale: 1,
      alpha: 1,
      rotation: 0,
      duration: 260,
      ease: 'Back.easeOut',
      onComplete: () => this.refreshQueue(true),
    });
    this.refreshQueue();
    this.refreshBoard();
  }

  private commitPlacement(pkg: CargoPackage, tier: number, slot: number, quiet = false) {
    const shelf = this.rack.shelves[tier];
    const localX = shelf.slotCentreX(slot, pkg.slots);
    const localY = shelf.packageCentreY;

    // Re-parent into the rack so the package inherits the tilt from now on.
    const local = this.rack.toLocal(pkg.view.x, pkg.view.y);
    this.children.remove(pkg.view);
    this.rack.container.add(pkg.view);
    this.rack.raiseOverlays();
    pkg.view.setPosition(local.x, local.y).setRotation(-this.rack.container.rotation);

    pkg.state = 'placed';
    pkg.shelf = tier;
    pkg.slot = slot;
    this.board.place(pkg.id, pkg.type, tier, slot);
    this.dragOrigin = null;

    const dist = Phaser.Math.Distance.Between(local.x, local.y, localX, localY);
    const duration = quiet ? 140 : Phaser.Math.Clamp(90 + dist * 0.32, 130, 300);

    this.tweens.add({
      targets: pkg.view,
      x: localX,
      y: localY,
      rotation: 0,
      scale: 1,
      duration,
      ease: quiet ? 'Quad.easeOut' : 'Back.easeIn',
      onComplete: () => this.onLanded(pkg, shelf.tier, quiet),
    });

    this.refreshBoard();
    this.refreshQueue();
  }

  private onLanded(pkg: CargoPackage, tier: number, quiet: boolean) {
    const shelf = this.rack.shelves[tier];
    pkg.landBounce(pkg.weight);
    shelf.flex(pkg.weight);

    if (!quiet) {
      const world = this.rack.toScene(pkg.view.x, pkg.view.y + PKG_H / 2);
      this.fx.dust(world.x, world.y, 5 + pkg.weight);
      if (pkg.type === 'heavy') {
        audio.placeHeavy();
        haptics.thud();
        this.fx.shake(0.004, 160);
        this.fx.impact(world.x, world.y, 0xf0a53c, 6);
      } else if (pkg.type === 'fragile') {
        audio.placeFragile();
        haptics.place();
      } else {
        audio.place(pkg.weight);
        haptics.place();
      }
    }
    this.refreshBoard();
  }

  private setBeltHighlight(on: boolean) {
    if (on === this.beltDropActive) return;
    this.beltDropActive = on;
    const g = this.beltHighlight;
    g.clear();
    if (!on) return;
    g.lineStyle(4, COLORS.accent, 0.85);
    g.strokeRoundedRect(
      14,
      this.layout.conveyorY - PKG_H - 14,
      396,
      PKG_H + this.layout.conveyorH + 30,
      14,
    );
    g.fillStyle(COLORS.accent, 0.1);
    g.fillRoundedRect(
      14,
      this.layout.conveyorY - PKG_H - 14,
      396,
      PKG_H + this.layout.conveyorH + 30,
      14,
    );
  }

  // ==========================================================================
  // Board state
  // ==========================================================================

  private placedPackages() {
    return this.packages.filter((p) => p.state === 'placed');
  }

  /** Recomputes every derived readout after any change to the board. */
  private refreshBoard() {
    const ev = this.board.evaluate();
    this.evalCache = ev;

    this.meter.setValue(ev.net, ev.leftTorque, ev.rightTorque, ev.status);
    this.rack.setBalance(ev.net, this.level.balanceTolerance, ev.status === 'danger');

    for (const shelf of this.rack.shelves) {
      shelf.setLoad(ev.shelfWeights[shelf.tier]);
      shelf.setOverloaded(ev.overloaded.includes(shelf.tier));
    }

    for (const pkg of this.packages) {
      if (pkg.type === 'fragile') pkg.setCracking(ev.crushed.includes(pkg.id));
    }

    this.rack.updateCrushColumns(
      this.placedPackages(),
      !!this.dragged && PlacementSystem.isCrusher(this.dragged.type),
    );

    const left = this.level.packages.length - this.board.count;
    this.hud.setRemaining(left, this.level.packages.length);

    const blocker = this.blockingReason(ev);
    this.canFinish = left === 0 && blocker === null;
    this.hud.setObjective(blocker ?? this.level.objective);
  }

  /** Why an otherwise-full rack has not been signed off yet. */
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

  override update(_time: number, delta: number) {
    const dt = Math.min(delta, 50);
    this.rack.tick(dt);
    this.meter.tick(dt);
    this.conveyor.tick(dt);
    if (this.dragged) this.updateDrag(dt);

    if (this.phase !== 'play') return;

    const ev = this.evalCache;
    const hazard = this.hazards.update(ev, dt);

    if (hazard.kind) {
      this.winAccum = 0;
      this.dismissTip();
      this.hud.showHazard(hazard.kind, hazard.remaining, hazard.total);
      this.fx.setDanger(true);
      this.runHazardAudio(dt, hazard.urgency);
      if (hazard.expired) {
        this.failLevel(
          hazard.kind === 'balance'
            ? 'collapse'
            : hazard.kind === 'overload'
              ? 'overload'
              : 'fragile',
          hazard.owner,
        );
      }
      return;
    }

    this.creakAccum = 0;
    this.beepAccum = 0;
    this.beepStep = 0;
    this.hud.hideHazard();
    this.fx.setDanger(false);

    // --- win ---------------------------------------------------------------
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
    const interval = 620 - urgency * 380;
    if (this.beepAccum > interval) {
      this.beepAccum = 0;
      audio.warn(this.beepStep++);
      if (urgency > 0.5) haptics.warn();
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
    const pending = this.queue.slice();
    const hint = hintFor(this.level, this.board.list, pending, currentId);

    if (hint.kind === 'stuck') {
      this.hud.toast('NO SOLUTION FROM HERE - TAP RESTART', 'info');
      return;
    }

    this.hintUsed = true;
    this.clearHint();

    const pkg = this.packages[currentId];
    pkg.setHinted(true);
    this.rack.showGhost(hint.shelf, hint.slot, pkg.slots, 'ok');

    if (hint.kind === 'rearrange') {
      this.hud.toast('SOME STOWED CARGO NEEDS MOVING TOO', 'info');
    }

    this.hintTimer = this.time.delayedCall(4200, () => this.clearHint());
  }

  private clearHint() {
    this.hintTimer?.remove();
    this.hintTimer = undefined;
    for (const p of this.packages) p.setHinted(false);
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
    this.fx.setDanger(false);

    const ev = this.evalCache;
    const limit = this.level.finalBalanceMax ?? this.level.balanceTolerance;

    let stars = 3;
    if (this.hintUsed || this.mistakes > 0 || ev.imbalance > limit * 0.4) stars = 2;
    if (this.mistakes >= 3) stars = 1;

    const previousBest = progress.bestBalanceFor(this.level.id);
    const record = progress.recordWin(this.level.id, stars, ev.imbalance);

    audio.win();
    haptics.win();
    this.fx.celebrate(this.layout.w / 2, this.layout.h * 0.34);

    this.rack.celebrate();

    this.time.delayedCall(520, () => {
      new WinPanel(
        this,
        this.layout,
        {
          levelId: this.level.id,
          levelName: this.level.name,
          stars,
          imbalance: ev.imbalance,
          tolerance: limit,
          packages: this.level.packages.length,
          mistakes: this.mistakes,
          hintUsed: this.hintUsed,
          isLastLevel: this.level.id >= TOTAL_LEVELS,
          newBest: record.balanceImproved && previousBest !== null,
          firstClear: previousBest === null,
        },
        {
          onNext: () => this.scene.restart({ levelId: this.level.id + 1 }),
          onRetry: () => this.restartLevel(),
          onLevels: () => this.scene.start('LevelSelect'),
        },
      );
    });
  }

  private failLevel(reason: FailReason, owner: number) {
    this.phase = 'resolving';
    this.clearHint();
    this.hud.hideHazard();
    this.fx.setDanger(false);

    let detail = '';
    const ev = this.evalCache;

    if (reason === 'collapse') {
      const dir = ev.net >= 0 ? 1 : -1;
      detail = `Imbalance reached ${ev.imbalance.toFixed(1)} against a limit of ${this.level.balanceTolerance.toFixed(1)}.`;
      audio.collapse();
      haptics.crash();
      this.fx.shake(0.02, 620);
      this.fx.flash(COLORS.bad, 120);
      this.rack.collapse(dir, () => undefined);
      this.time.delayedCall(180, () => this.spillCargo(this.placedPackages(), dir));
    } else if (reason === 'overload') {
      const shelf = this.rack.shelves[owner];
      detail = `Tier ${owner + 1} carried ${ev.shelfWeights[owner]} against a rating of ${shelf.def.maxWeight}.`;
      audio.collapse();
      haptics.crash();
      this.fx.shake(0.014, 480);
      const victims = this.placedPackages().filter((p) => p.shelf <= owner);
      this.time.delayedCall(120, () => this.spillCargo(victims, ev.net >= 0 ? 1 : -1));
    } else {
      const pkg = this.packages[owner];
      detail = 'A heavy crate was stacked in the column above the glass.';
      audio.shatter();
      haptics.crash();
      this.fx.shake(0.01, 320);
      if (pkg && pkg.state === 'placed') {
        const world = this.rack.toScene(pkg.view.x, pkg.view.y);
        this.fx.glass(world.x, world.y, 26);
        this.tweens.add({
          targets: pkg.view,
          alpha: 0,
          scaleX: 1.25,
          scaleY: 0.7,
          duration: 220,
        });
      }
    }

    audio.fail();
    const delay = reason === 'fragile' ? 900 : 1500;

    if (this.run) {
      const run = this.run;
      const newBest = progress.recordRun(run.score, run.wave);
      const stats = progress.endless;
      this.time.delayedCall(delay, () => {
        new RunOverPanel(
          this,
          this.layout,
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
            onRetry: () => this.scene.restart({ run: newRun() }),
            onMenu: () => this.scene.start('Menu'),
          },
        );
      });
      return;
    }

    this.time.delayedCall(delay, () => {
      new FailPanel(this, this.layout, reason, detail, {
        onRetry: () => this.restartLevel(),
        onLevels: () => this.scene.start('LevelSelect'),
      });
    });
  }

  /** Tumbles cargo out of the rack. Deterministic per package id - no RNG. */
  private spillCargo(victims: CargoPackage[], dir: number) {
    const floorY = this.layout.rackBaseY + 40;
    victims.forEach((pkg, i) => {
      const world = this.rack.toScene(pkg.view.x, pkg.view.y);
      this.rack.container.remove(pkg.view);
      this.add.existing(pkg.view);
      pkg.view.setPosition(world.x, world.y).setDepth(70).setScale(this.rack.scale);
      pkg.setCracking(false);

      // Stable pseudo-random spread so a replay of the same board looks the same.
      const r = ((pkg.id * 9301 + 49297) % 233280) / 233280;
      const tx = Phaser.Math.Clamp(
        world.x + dir * (60 + r * 190) + (r - 0.5) * 120,
        60,
        this.layout.w - 60,
      );

      this.tweens.add({
        targets: pkg.view,
        x: tx,
        y: floorY - r * 18,
        angle: dir * (40 + r * 220),
        duration: 520 + r * 260,
        delay: i * 45,
        ease: 'Bounce.easeOut',
        onComplete: () => {
          this.fx.debris(pkg.view.x, pkg.view.y + PKG_H / 2, 6);
          this.fx.dust(pkg.view.x, pkg.view.y + PKG_H / 2, 6);
        },
      });
    });
  }

  // ==========================================================================
  // Menus
  // ==========================================================================

  // ==========================================================================
  // Endless mode
  // ==========================================================================

  /** The coaching line shown as a wave starts. */
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
    const tiers = this.level.shelves.length;
    const grace = (GRACE_MS.balance * this.graceScale) / 1000;
    const stats =
      `${this.level.packages.length} packages - ${tiers} tiers - ` +
      `red line ${this.level.balanceTolerance.toFixed(1)}` +
      (this.graceScale < 0.99 ? ` - ${grace.toFixed(1)}s to fix a mistake` : '');
    return note ? `${note}
${stats}` : stats;
  }

  /** Endless: bank the shipment, roll the next wave. */
  private clearWave() {
    const run = this.run;
    if (!run) return;

    this.phase = 'resolving';
    this.clearHint();
    this.hud.hideHazard();
    this.fx.setDanger(false);
    this.dismissTip();

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
    this.fx.celebrate(this.layout.w / 2, this.layout.h * 0.3);
    this.rack.celebrate();
    this.dispatchCargo();

    this.waveCard = new WaveClearCard(this, this.layout, run.wave, result);

    // Auto-advances, but a tap skips ahead once the card has had a beat to
    // land - a run should never feel like it is waiting on an animation.
    this.time.delayedCall(700, () => {
      if (this.phase === 'resolving') this.input.once('pointerdown', () => this.advanceWave());
    });
    this.time.delayedCall(2400, () => this.advanceWave());
  }

  /** Cargo rides off the rack to the right, like a truck taking the load. */
  private dispatchCargo() {
    const packages = this.placedPackages().sort((a, b) => a.view.x - b.view.x);
    // Empty the board first so the shelf load bars and the balance meter drain
    // along with the animation instead of freezing on the old shipment.
    this.board.clear();
    packages.forEach((pkg, i) => {
      const world = this.rack.toScene(pkg.view.x, pkg.view.y);
      this.rack.container.remove(pkg.view);
      this.add.existing(pkg.view);
      pkg.view.setPosition(world.x, world.y).setDepth(70).setScale(this.rack.scale);
      pkg.setCracking(false);

      this.tweens.add({
        targets: pkg.view,
        x: this.layout.w + 240,
        y: world.y - 16,
        angle: 5,
        alpha: 0,
        delay: i * 55,
        duration: 540,
        ease: 'Back.easeIn',
        onStart: () => {
          this.fx.dust(world.x, world.y + PKG_H / 2, 4);
          audio.pickup();
        },
      });
    });

    for (const pkg of packages) {
      pkg.state = 'falling';
      pkg.shelf = -1;
      pkg.slot = -1;
    }
    this.refreshBoard();
    // refreshBoard() reads "nothing on the rack" as "nothing stowed yet"; after
    // a dispatch the truthful count is zero left to stow.
    this.hud.setRemaining(0, this.level.packages.length);
  }

  private advanceWave() {
    const run = this.run;
    if (!run || this.advancing) return;
    this.advancing = true;
    this.waveCard?.dismiss();
    run.wave++;
    this.cameras.main.fadeOut(200, 13, 17, 23);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart({ run }));
  }

  private openLegend() {
    if (this.phase !== 'play') return;
    this.cancelDrag();
    this.phase = 'paused';
    new LegendPanel(this, this.layout, () => {
      this.phase = 'play';
    });
  }

  private openPause() {
    if (this.phase !== 'play') return;
    this.cancelDrag();
    this.phase = 'paused';
    new PausePanel(this, this.layout, {
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
      onRestart: () => (this.run ? this.scene.start('Menu') : this.restartLevel()),
      onLevels: () => this.scene.start(this.run ? 'Menu' : 'LevelSelect'),
    });
  }

  private restartLevel() {
    this.scene.restart({ levelId: this.level.id });
  }

  private dismissTip() {
    if (!this.tipCard) return;
    const card = this.tipCard;
    this.tipCard = undefined;
    this.tweens.killTweensOf(card);
    this.tweens.add({
      targets: card,
      alpha: 0,
      duration: 180,
      onComplete: () => card.destroy(),
    });
  }

  private showTip(text: string) {
    const y = this.layout.meterY + this.layout.meterH + 40;
    const t = this.add
      .text(0, 0, text, {
        fontFamily: FONT,
        fontSize: '19px',
        color: HEX.text,
        align: 'center',
        wordWrap: { width: 470 },
      })
      .setOrigin(0.5);
    const w = Math.min(540, t.width + 52);
    const h = t.height + 34;
    const g = this.add.graphics();
    g.fillStyle(0x0b1017, 0.94);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
    g.lineStyle(2, COLORS.accent, 0.8);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);

    const card = this.add.container(this.layout.w / 2, y, [g, t]).setDepth(90);
    this.tipCard = card;
    card.setAlpha(0).setScale(0.9);
    this.tweens.add({ targets: card, alpha: 1, scale: 1, duration: 240, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: card,
      alpha: 0,
      y: y - 22,
      delay: 4600,
      duration: 420,
      onComplete: () => {
        if (this.tipCard === card) this.tipCard = undefined;
        card.destroy();
      },
    });
  }
}
