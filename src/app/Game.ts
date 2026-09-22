/**
 * Gameplay controller. Owns the shipment's GameSession, the DOM UI (HUD,
 * meter, panels, controls), audio and haptics, a GameView from the current
 * stage and the pointer InteractionController.
 *
 * The session is the only rules state: every change is one command on it,
 * followed by the view transition and a sync. The view only draws. This file
 * must not import three.js or anything under src/render/three.
 *
 * Design rule enforced everywhere: nothing ever fails instantly. Imbalance,
 * overloading and crushing all raise a visible countdown first, and the player
 * can always pick cargo back up to fix it - but holding a package does not
 * stop the countdown; only a committed move does.
 */

import type { AppContext, Screen } from './Router';
import { GRACE_MS } from '../game/config';
import { getWave, prefetchWave } from '../game/levels/generator';
import { getLevel, TOTAL_LEVELS } from '../game/levels/levels';
import { PACKAGE_SPECS } from '../game/levels/types';
import type { LevelDef } from '../game/levels/types';
import { campaignStars, GameSession, nextWave, rewardWave, waveSource } from '../game/session';
import type { BlockReason, ShipmentOutcome, ShipmentSnapshot, TickResult } from '../game/session';
import { audio } from '../game/systems/AudioManager';
import { haptics } from '../game/systems/Haptics';
import { requestHint } from '../game/systems/HintService';
import { progress } from '../game/systems/ProgressManager';
import { formatScore, newRun } from '../game/systems/RunManager';
import type { RunState } from '../game/systems/RunManager';
import { InteractionController } from '../input/InteractionController';
import type { BoardView, ClientPoint, DropTarget, GameView, RenderMode } from '../render/GameView';
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

export interface GameData {
  levelId?: number;
  run?: RunState;
}

/** Read-only probe for browser tests (`?e2e`) and dev builds. */
export interface GameTestHook {
  readonly mode: RenderMode;
  snapshot(): ShipmentSnapshot;
  board(): BoardView;
  /** The drop target currently shown for the package in hand (what a release would commit), or null. */
  aimed(): DropTarget | null;
  clientPointOf(target: Parameters<GameView['clientPointOf']>[0]): ClientPoint | null;
}

declare global {
  interface Window {
    __cargoPanic?: GameTestHook;
  }
}

function testHookEnabled(): boolean {
  try {
    return import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e');
  } catch {
    return false;
  }
}

/** HUD copy for why a fully stowed board cannot finish yet. */
function blockText(r: BlockReason): string {
  switch (r.key) {
    case 'overloaded':
      return 'A SHELF IS OVER ITS LOAD LIMIT';
    case 'crushed':
      return 'FRAGILE CARGO IS BEING CRUSHED';
    case 'priority':
      return 'PRIORITY CARGO MUST SIT IN THE GOLD ZONE';
    case 'imbalance':
      return `IMBALANCE MUST DROP BELOW ${r.limit.toFixed(1)}`;
  }
}

export function gameScreen(ctx: AppContext, data: GameData): Screen {
  return new GameController(ctx, data);
}

class GameController implements Screen {
  private level: LevelDef;
  private run: RunState | null;
  private graceScale: number;
  private session: GameSession;

  private view!: GameView;
  private interaction!: InteractionController;
  private hud!: Hud;
  private meter!: Meter;
  private controls!: HTMLElement;
  private beltZone!: HTMLElement;
  private dangerEl!: HTMLElement;

  private creakAccum = 0;
  private beepAccum = 0;
  private beepStep = 0;
  private hintTimer = 0;
  private tip?: TipCard;
  private waveCard?: WaveClearCard;
  private advancing = false;
  private timers: number[] = [];
  private offFrame?: () => void;
  private offAdvanceTap?: () => void;
  private testHook?: GameTestHook;

  constructor(
    private ctx: AppContext,
    data: GameData,
  ) {
    this.run = data.run ?? null;
    if (this.run) {
      const plan = getWave(this.run.seed, this.run.wave);
      this.level = plan.level;
      this.graceScale = plan.graceScale;
      this.session = new GameSession(this.level, {
        source: waveSource(this.run),
        graceScale: this.graceScale,
      });
    } else {
      this.level = getLevel(data.levelId ?? 1);
      this.graceScale = 1;
      this.session = new GameSession(this.level, { source: { mode: 'campaign', levelId: this.level.id } });
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  enter() {
    const stage = this.ctx.stage;
    this.view = stage.createGameView();
    this.view.mount(this.boardView());

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

    this.refreshUi();

    if (this.run) {
      this.tip = new TipCard(this.waveIntro());
      const run = this.run;
      this.after(120, () => prefetchWave(run.seed, run.wave + 1));
    } else if (this.level.tip) {
      this.tip = new TipCard(this.level.tip);
    }

    this.interaction = new InteractionController({
      surface: stage.canvas,
      session: this.session,
      view: this.view,
      hooks: {
        grabbed: () => {
          audio.unlock();
          this.clearHint();
          this.tip?.dismiss();
          audio.pickup();
          haptics.tap();
        },
        preview: (net) => (net === null ? this.meter.hidePreview() : this.meter.showPreview(net)),
        beltHover: (on) => this.beltZone.classList.toggle('on', on),
        rejected: (reason) => {
          this.hud.toast(reason);
          audio.invalid();
          haptics.reject();
        },
        placed: () => this.refresh(),
        landed: (id) => this.landingFeedback(id),
        toBelt: () => {
          this.hud.toast('BACK ON THE BELT', 'info');
          this.refresh();
        },
      },
    });
    this.interaction.attach();

    this.offFrame = this.ctx.loop.onFrame(this.frame);
    this.installTestHook();
    fadeIn();
  }

  exit() {
    this.offFrame?.();
    this.interaction.detach();
    this.offAdvanceTap?.();
    for (const t of this.timers) clearTimeout(t);
    clearTimeout(this.hintTimer);
    this.tip?.dismiss();
    this.waveCard?.dismiss();
    this.view.dispose();
    this.hud.destroy();
    this.meter.destroy();
    this.controls.remove();
    this.beltZone.remove();
    this.dangerEl.remove();
    if (this.testHook && window.__cargoPanic === this.testHook) delete window.__cargoPanic;
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
    this.interaction.cancel();
    const id = this.level.id;
    this.goto((c) => gameScreen(c, { levelId: id }));
  }

  private installTestHook() {
    if (!testHookEnabled()) return;
    const hook: GameTestHook = {
      mode: this.view.mode,
      snapshot: () => this.session.snapshot(),
      board: () => this.boardView(),
      aimed: () => this.interaction.aimed,
      clientPointOf: (t) => this.view.clientPointOf(t),
    };
    this.testHook = Object.freeze(hook);
    window.__cargoPanic = this.testHook;
  }

  // ==========================================================================
  // Board state
  // ==========================================================================

  private boardView(): BoardView {
    const s = this.session;
    const evaluation = s.evaluation;
    return {
      level: s.level,
      queue: s.queue,
      placements: s.placements,
      evaluation,
      held: s.held,
      wobble: evaluation.status === 'danger',
    };
  }

  /** After every committed command: redraw the board, then the HUD and meter. */
  private refresh() {
    this.view.sync(this.boardView());
    this.refreshUi();
  }

  private refreshUi() {
    const s = this.session;
    const ev = s.evaluation;
    this.meter.setValue(ev.net, ev.leftTorque, ev.rightTorque, ev.status);
    this.hud.setRemaining(s.remaining, this.level.packages.length);
    const blocker = s.blockReason();
    this.hud.setObjective(blocker ? blockText(blocker) : this.level.objective);
  }

  /** Touchdown sound and buzz for a committed placement, by cargo type. */
  private landingFeedback(id: number) {
    const type = this.level.packages[id];
    if (type === 'heavy') {
      audio.placeHeavy();
      haptics.thud();
    } else if (type === 'fragile') {
      audio.placeFragile();
      haptics.place();
    } else {
      audio.place(PACKAGE_SPECS[type].weight);
      haptics.place();
    }
  }

  // ==========================================================================
  // Per-frame
  // ==========================================================================

  private frame = (animMs: number, realMs: number) => {
    this.view.update(animMs);
    this.interaction.update();
    this.meter.tick(animMs);
    if (this.session.phase !== 'play') return;

    const r = this.session.advance(realMs);
    this.showHazard(r, realMs);
    if (r.outcome) this.onOutcome(r.outcome);
  };

  private showHazard(r: TickResult, dt: number) {
    const hazard = r.hazard;
    if (hazard.kind) {
      this.tip?.dismiss();
      this.hud.showHazard(hazard.kind, hazard.remaining, hazard.total);
      this.dangerEl.classList.add('on');
      this.runHazardAudio(dt, hazard.urgency);
      return;
    }
    this.creakAccum = 0;
    this.beepAccum = 0;
    this.beepStep = 0;
    this.hud.hideHazard();
    this.dangerEl.classList.remove('on');
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

  private onOutcome(o: ShipmentOutcome) {
    // Whatever is in hand stays where the rules had it; its pointerup is ignored.
    this.interaction.abort();
    this.beltZone.classList.remove('on');
    this.meter.hidePreview();
    if (o.result === 'won') {
      if (this.run) this.clearWave(o);
      else this.winLevel(o);
    } else {
      this.failLevel(o);
    }
  }

  // ==========================================================================
  // Hint
  // ==========================================================================

  private onHint() {
    if (this.session.phase !== 'play') return;
    // A second finger on HINT mid-drag: the package goes back first (the session refuses hints while one is held).
    this.interaction.cancel();
    if (this.session.queue.length === 0) {
      this.hud.toast('EVERYTHING IS STOWED - FIX THE BALANCE', 'info');
      return;
    }
    requestHint(() => this.applyHint());
  }

  private applyHint() {
    const current = this.session.current;
    const hint = this.session.hint();
    if (current === null || !hint) return;
    if (hint.kind === 'stuck') {
      this.hud.toast('NO SOLUTION FROM HERE - TAP RESTART', 'info');
      return;
    }
    this.clearHint();
    this.view.showHint(current, { shelf: hint.shelf, slot: hint.slot });
    if (hint.kind === 'rearrange') this.hud.toast('SOME STOWED CARGO NEEDS MOVING TOO', 'info');
    this.hintTimer = window.setTimeout(() => this.clearHint(), 4200);
  }

  private clearHint() {
    clearTimeout(this.hintTimer);
    this.view.clearHint();
  }

  // ==========================================================================
  // Resolution
  // ==========================================================================

  private endHazardUi() {
    this.clearHint();
    this.hud.hideHazard();
    this.dangerEl.classList.remove('on');
  }

  private winLevel(o: ShipmentOutcome) {
    this.endHazardUi();
    const stars = campaignStars(o);
    const previousBest = progress.bestBalanceFor(this.level.id);
    const record = progress.recordWin(this.level.id, stars, o.imbalance);

    audio.win();
    haptics.win();
    this.view.celebrate();

    const id = this.level.id;
    this.after(520, () => {
      new WinPanel(
        {
          levelId: id,
          stars,
          imbalance: o.imbalance,
          tolerance: o.limit,
          packages: this.level.packages.length,
          mistakes: o.rejectedDrops,
          hintUsed: o.assists.hints > 0,
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

  private failLevel(o: ShipmentOutcome) {
    this.endHazardUi();
    const f = o.failure;
    const net = this.session.evaluation.net;
    let reason: FailReason;
    let detail: string;

    if (!f || f.kind === 'balance') {
      reason = 'collapse';
      const imbalance = f?.imbalance ?? o.imbalance;
      const tolerance = f?.tolerance ?? this.level.balanceTolerance;
      detail = `Imbalance reached ${imbalance.toFixed(1)} against a limit of ${tolerance.toFixed(1)}.`;
      audio.collapse();
      haptics.crash();
      this.flash();
      this.view.failCollapse((f?.net ?? net) >= 0 ? 1 : -1);
    } else if (f.kind === 'overload') {
      reason = 'overload';
      detail = `Tier ${f.tier + 1} carried ${f.load} against a rating of ${f.max}.`;
      audio.collapse();
      haptics.crash();
      this.view.failOverload(f.tier, net >= 0 ? 1 : -1);
    } else {
      reason = 'fragile';
      detail = 'A heavy crate was stacked in the column above the glass.';
      audio.shatter();
      haptics.crash();
      this.view.failFragile(f.fragileId);
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

  private clearWave(o: ShipmentOutcome) {
    const run = this.run;
    if (!run) return;
    this.endHazardUi();
    this.tip?.dismiss();

    // Applied once per wave, however often this is reached.
    const { result } = rewardWave(run, this.level, o);

    audio.win();
    haptics.win();
    this.hud.setSubtitle(formatScore(run.score));
    this.hud.pulseSubtitle();
    this.view.celebrate();
    this.view.dispatch({ onEach: () => audio.pickup() });
    // The rack is empty now: the readouts follow.
    this.meter.setValue(0, 0, 0, 'stable');
    this.hud.setObjective(this.level.objective);
    this.hud.setRemaining(0, this.level.packages.length);
    this.waveCard = new WaveClearCard(result);

    this.after(700, () => {
      if (this.advancing) return;
      const canvas = this.ctx.stage.canvas;
      const tap = () => this.advanceWave();
      canvas.addEventListener('pointerdown', tap, { once: true });
      this.offAdvanceTap = () => canvas.removeEventListener('pointerdown', tap);
    });
    this.after(2400, () => this.advanceWave());
  }

  private advanceWave() {
    const run = this.run;
    if (!run || this.advancing) return;
    this.advancing = true;
    this.offAdvanceTap?.();
    this.waveCard?.dismiss();
    nextWave(run);
    this.goto((c) => gameScreen(c, { run }));
  }

  // ==========================================================================
  // Menus
  // ==========================================================================

  /** Opening a panel mid-drag puts the package back; the rules clocks stop while it is open. */
  private suspendPlay(): boolean {
    if (this.session.phase !== 'play') return false;
    this.interaction.cancel();
    this.session.pause();
    return true;
  }

  private openLegend() {
    if (!this.suspendPlay()) return;
    new LegendPanel(() => {
      this.session.resume();
    });
  }

  private openPause() {
    if (!this.suspendPlay()) return;
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
        this.session.resume();
      },
      restartLabel: this.run ? 'END RUN' : 'RESTART LEVEL',
      exitLabel: this.run ? 'MAIN MENU' : 'LEVEL SELECT',
      onRestart: () => (this.run ? this.goto(menuScreen) : this.restartLevel()),
      onExit: () => this.goto(this.run ? menuScreen : levelSelectScreen),
    });
  }
}
