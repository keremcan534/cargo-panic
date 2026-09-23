/**
 * Gameplay controller. Owns the shipment's GameSession, the DOM UI (HUD,
 * meter, panels, controls), audio and haptics, a GameView from the current
 * stage and the pointer InteractionController.
 *
 * The session is the only rules state: every change is one command on it,
 * followed by the view transition and a sync. The view only draws. This file
 * must not import three.js or anything under src/render/three.
 *
 * The view is replaceable: a render-mode switch (pause panel, or the 2D
 * fallback after a lost WebGL context) disposes the view and mounts a new
 * one from the SAME session - placements, queue, hazard clocks, score and
 * assists are untouched. Pointer input listens on the stable #game-root, so
 * only the view reference changes. While the view is swapped the session is
 * held by the 'switching' pause reason; see PauseReasons.
 *
 * Design rule enforced everywhere: nothing ever fails instantly. Imbalance,
 * overloading and crushing all raise a visible countdown first, and the player
 * can always pick cargo back up to fix it - but holding a package does not
 * stop the countdown; only a committed move does.
 */

import type { AppContext, Screen } from './Router';
import { PauseReasons } from './PauseReasons';
import type { PauseReason } from './PauseReasons';
import type { SwitchResult } from './StageHost';
import { GRACE_MS } from '../game/config';
import { getWave, prefetchWave } from '../game/levels/generator';
import { getLevel, TOTAL_LEVELS } from '../game/levels/levels';
import { PACKAGE_SPECS } from '../game/levels/types';
import type { LevelDef } from '../game/levels/types';
import { campaignStars, GameSession, nextWave, rewardWave, waveSource } from '../game/session';
import type { BlockReason, ShipmentOutcome, ShipmentSnapshot, TickResult } from '../game/session';
import { audio } from '../game/systems/AudioManager';
import { evaluate } from '../game/systems/BalanceSystem';
import { haptics } from '../game/systems/Haptics';
import { requestHint } from '../game/systems/HintService';
import { hintFor } from '../game/systems/Solver';
import { progress } from '../game/systems/ProgressManager';
import { formatScore, newRun } from '../game/systems/RunManager';
import type { RunState } from '../game/systems/RunManager';
import { fmt, levelText, t } from '../i18n';
import { InteractionController } from '../input/InteractionController';
import type { BoardView, ClientPoint, DropTarget, GameView, RenderMode } from '../render/GameView';
import type { Stage } from '../render/Stage';
import { Hud } from '../ui/Hud';
import { levelSelectScreen } from '../ui/LevelSelect';
import { menuScreen } from '../ui/Menu';
import { Meter } from '../ui/Meter';
import {
  FailPanel,
  LegendPanel,
  PausePanel,
  RunOverPanel,
  SuggestCard,
  TipCard,
  WaveClearCard,
  WinPanel,
} from '../ui/Panels';
import type { FailReason } from '../ui/Panels';
import { Tutorial } from '../ui/Tutorial';
import { TutorialFlow } from '../ui/tutorialFlow';
import type { TutorialStore } from '../ui/tutorialFlow';
import { viewControls } from '../ui/ViewSettings';
import { btn, el, fadeIn, fadeOut, iconBtn, uiRoot } from '../ui/dom';

/** One free undo per shipment (campaign level or Endless wave); a new wave is a new session. */
const UNDO_PER_SHIPMENT = 1;

export interface GameData {
  levelId?: number;
  run?: RunState;
}

/** Read-only probe for browser tests (`?e2e`) and dev builds. */
export interface GameTestHook {
  /** Mode of the view drawing the board now (changes on a view switch). */
  readonly mode: RenderMode;
  /** Why the session is paused right now (empty while playing). */
  readonly pauseReasons: PauseReason[];
  /** FrameLoop subscribers and frames drawn: a switch must not add loops. */
  readonly loopSubscribers: number;
  readonly loopFrames: number;
  snapshot(): ShipmentSnapshot;
  board(): BoardView;
  /** The drop target currently shown for the package in hand (what a release would commit), or null. */
  aimed(): DropTarget | null;
  /** The tap-selected package, or null. */
  selection(): number | null;
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
      return t('block.overloaded');
    case 'crushed':
      return t('block.crushed');
    case 'priority':
      return t('block.priority');
    case 'imbalance':
      return t('block.imbalance', { limit: fmt(r.limit) });
  }
}

/** The tutorial flags in the save. */
const tutorialStore: TutorialStore = {
  get done() {
    return progress.tutorial.done;
  },
  get skipped() {
    return progress.tutorial.skipped;
  },
  mark: (step) => progress.markTutorial(step),
  skip: () => progress.setTutorialSkipped(true),
};

/** Cargo types explained once, the first time one is the live belt package. */
const EXPLAINED = ['heavy', 'fragile', 'long', 'priority'] as const;
type ExplainedType = (typeof EXPLAINED)[number];
const isExplained = (type: string): type is ExplainedType => (EXPLAINED as readonly string[]).includes(type);

/**
 * A shelf as a loss message names it: the bottom one, the top one (on a rack
 * with more than one), otherwise by number from the bottom. `on` is the form
 * used after "on" in the fragile message.
 */
function shelfName(tier: number, tiers: number, form: 'start' | 'on' = 'start'): string {
  if (tier === 0) return form === 'on' ? t('shelf.bottomOn') : t('shelf.bottom');
  if (tier === tiers - 1) return form === 'on' ? t('shelf.topOn') : t('shelf.top');
  return form === 'on' ? t('shelf.nOn', { n: tier + 1 }) : t('shelf.n', { n: tier + 1 });
}

/** Endless waves that open with a note about what is new. */
const WAVE_NOTES = [1, 2, 4, 6, 9, 12] as const;
type WaveNoteKey = `wave.intro.${(typeof WAVE_NOTES)[number]}`;

export function gameScreen(ctx: AppContext, data: GameData): Screen {
  return new GameController(ctx, data);
}

class GameController implements Screen {
  private level: LevelDef;
  private run: RunState | null;
  private graceScale: number;
  private session: GameSession;
  private pauses: PauseReasons;

  private view!: GameView;
  /** False between detachStage and attachStage (a view switch in progress). */
  private viewLive = false;
  private interaction!: InteractionController;
  private surface!: HTMLElement;
  private hud!: Hud;
  private meter!: Meter;
  private controls!: HTMLElement;
  private controlsText!: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private hintBtn!: HTMLButtonElement;
  private helpBtn!: HTMLButtonElement;
  private beltZone!: HTMLElement;
  private dangerEl!: HTMLElement;

  private creakAccum = 0;
  private beepAccum = 0;
  private beepStep = 0;
  private tip?: TipCard;
  /** First-encounter cargo explainer; unlike the level tip it stays up while the player grabs. */
  private cargoTip?: TipCard;
  private tutorial: Tutorial | null = null;
  /** Level 1 guide: where the demonstration hand takes the live package. */
  private placeTarget: { shelf: number; slot: number; slots: number } | null = null;
  private waveCard?: WaveClearCard;
  private suggestion?: SuggestCard;
  private pausePanel: PausePanel | null = null;
  private legendOpen = false;
  private advancing = false;
  /** Endless: the cleared rack has been dispatched (a new view starts empty). */
  private dispatched = false;
  /** After an outcome: replays its look on a view mounted later (a switch). Rules are not involved. */
  private outcomeLook: ((view: GameView) => void) | null = null;
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
        undoAllowance: UNDO_PER_SHIPMENT,
      });
    } else {
      this.level = getLevel(data.levelId ?? 1);
      this.graceScale = 1;
      this.session = new GameSession(this.level, {
        source: { mode: 'campaign', levelId: this.level.id },
        undoAllowance: UNDO_PER_SHIPMENT,
      });
    }
    this.pauses = new PauseReasons(this.session);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  enter() {
    this.mountView(this.ctx.stage);

    this.meter = new Meter(this.level.balanceTolerance);
    this.hud = new Hud(
      this.run
        ? {
            title: t('hud.wave', { n: this.run.wave }),
            subtitle: formatScore(this.run.score),
            subtitleGold: true,
            objective: this.objective(),
            showRestart: false,
          }
        : {
            title: t('hud.level', { n: this.level.id }),
            subtitle: levelText(this.level.id, 'name', this.level.name),
            objective: this.objective(),
            showRestart: true,
          },
      { onRestart: () => this.restartLevel(), onPause: () => this.openPause() },
    );

    const hint = btn(t('hud.hint'), () => this.onHint(), 'gold', 'sm');
    hint.dataset.role = 'hint';
    this.hintBtn = hint;
    // Stays clickable when unavailable (aria-disabled, not disabled) so a press can say why.
    this.undoBtn = btn(t('hud.undo'), () => this.onUndo(), 'secondary', 'sm', 'undo');
    this.undoBtn.dataset.role = 'undo';
    this.controlsText = el('div', { class: 'hint-text', text: t('hud.controlsHintTap') });
    this.controlsText.dataset.role = 'controls-text';
    const help = iconBtn('help', () => this.openLegend(), t('hud.guide'));
    help.classList.add('help');
    this.helpBtn = help;
    this.controls = el('div', { class: 'controls' }, [help, this.controlsText, this.undoBtn, hint]);
    this.beltZone = el('div', { class: 'belt-zone' }, [el('span', { text: t('hud.beltZone') })]);
    this.dangerEl = el('div', { id: 'danger' });
    uiRoot().append(this.dangerEl, this.beltZone, this.controls);

    this.refreshUi();

    this.startTutorial();
    if (this.run) {
      this.tip = new TipCard(this.waveIntro());
      const run = this.run;
      this.after(120, () => prefetchWave(run.seed, run.wave + 1));
    } else if (this.level.tip && !this.tutorial?.step) {
      // (A guide step on screen from the start says the same thing, with a pointer.)
      this.tip = new TipCard(levelText(this.level.id, 'tip', this.level.tip));
    }
    this.explainNewCargo();

    // The stable root under the canvas: a view switch replaces the canvas, not this.
    this.surface = document.getElementById('game-root') as HTMLElement;
    this.interaction = new InteractionController({
      surface: this.surface,
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
          this.hud.toast(t(`reject.${reason}` as const));
          audio.invalid();
          haptics.reject();
        },
        placed: (_id, _quiet, from) => {
          this.refresh();
          this.tutorial?.moved(from.at === 'shelf', this.session.placements.length);
        },
        selected: (id) => this.showControlsText(id !== null),
        landed: (id) => this.landingFeedback(id),
        toBelt: () => {
          this.hud.toast(t('toast.backOnBelt'), 'info');
          this.refresh();
        },
      },
    });
    this.interaction.attach();
    window.addEventListener('keydown', this.onKey);

    this.offFrame = this.ctx.loop.onFrame(this.frame);
    this.installTestHook();
    fadeIn();
  }

  exit() {
    this.offFrame?.();
    this.interaction.detach();
    window.removeEventListener('keydown', this.onKey);
    this.offAdvanceTap?.();
    for (const t of this.timers) clearTimeout(t);
    this.tip?.dismiss();
    this.cargoTip?.dismiss();
    this.tutorial?.dispose();
    this.waveCard?.dismiss();
    this.suggestion?.dismiss();
    if (this.viewLive) this.view.dispose();
    this.viewLive = false;
    this.hud.destroy();
    this.meter.destroy();
    this.controls.remove();
    this.beltZone.remove();
    this.dangerEl.remove();
    if (this.testHook && window.__cargoPanic === this.testHook) delete window.__cargoPanic;
  }

  // ==========================================================================
  // View switching (see StageHost for the whole sequence)
  // ==========================================================================

  /** Steps 1-2: cancel any drag (nothing changes in the session), hold the session, drop the view. */
  detachStage() {
    if (!this.viewLive) return;
    this.interaction.reset();
    this.pauses.add('switching');
    this.view.dispose();
    this.viewLive = false;
  }

  /** Step 6: a new view on the new stage, mounted from the same session. It stays paused. */
  attachStage(stage: Stage, _result: SwitchResult) {
    if (this.viewLive) return;
    this.mountView(stage);
    this.interaction.setView(this.view);
    if (this.pauses.has('context-lost')) {
      // We are here because the lost 3D context never came back: the player
      // resumes from the pause panel, like after any switch.
      this.openPause();
      this.pauses.remove('context-lost');
    }
    this.pauses.remove('switching');
  }

  stageLost() {
    this.interaction.cancel();
    this.pauses.add('context-lost');
  }

  /**
   * The language changed (from the pause panel): the HUD, meter and controls
   * switch now; the pause panel is rebuilt in place, still paused. The
   * shelf plaques in the view pick it up on the next level.
   */
  languageChanged() {
    const run = this.run;
    this.hud.setTitle(run ? t('hud.wave', { n: run.wave }) : t('hud.level', { n: this.level.id }));
    if (!run) this.hud.setSubtitle(levelText(this.level.id, 'name', this.level.name));
    this.hud.relabel();
    this.meter.relabel();
    this.refreshUi();
    this.showControlsText(this.interaction.selection !== null);
    this.undoBtn.textContent = t('hud.undo');
    this.hintBtn.textContent = t('hud.hint');
    this.helpBtn.title = t('hud.guide');
    this.helpBtn.setAttribute('aria-label', t('hud.guide'));
    const belt = this.beltZone.querySelector('span');
    if (belt) belt.textContent = t('hud.beltZone');
    this.tutorial?.relabel();
    // A panel already closing (RESUME, RESTART, EXIT) finishes its own close and resume.
    if (this.pausePanel?.open) {
      this.pausePanel.dismissNow();
      this.pausePanel = null;
      this.openPause();
    }
  }

  stageRestored() {
    this.pauses.remove('context-lost');
  }

  private mountView(stage: Stage) {
    this.view = stage.createGameView();
    this.view.mount(this.mountBoard());
    this.outcomeLook?.(this.view);
    this.viewLive = true;
  }

  /** The board a new view starts from: the session's, or the empty rack once Endless has dispatched it. */
  private mountBoard(): BoardView {
    const b = this.boardView();
    if (!this.dispatched) return b;
    const empty = evaluate(this.level, []);
    return { ...b, placements: [], queue: [], held: null, evaluation: empty, wobble: false };
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.repeat) this.openPause();
  };

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
    const self = this;
    const hook: GameTestHook = {
      get mode() {
        return self.view.mode;
      },
      get pauseReasons() {
        return self.pauses.list();
      },
      get loopSubscribers() {
        return self.ctx.loop.subscribers;
      },
      get loopFrames() {
        return self.ctx.loop.frames;
      },
      snapshot: () => this.session.snapshot(),
      board: () => this.boardView(),
      aimed: () => this.interaction.aimed,
      selection: () => this.interaction.selection,
      clientPointOf: (target) => (this.viewLive ? this.view.clientPointOf(target) : null),
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

  /** The line next to the buttons: how to play, or what to do with the selected package. */
  private showControlsText(selected: boolean) {
    this.controlsText.textContent = selected ? t('hud.selected') : t('hud.controlsHintTap');
    this.controlsText.classList.toggle('selected', selected);
  }

  /** After every committed command: redraw the board, then the HUD and meter. */
  private refresh() {
    if (this.viewLive) this.view.sync(this.boardView());
    this.refreshUi();
    this.explainNewCargo();
  }

  // ==========================================================================
  // First-session guide and first-encounter cargo
  // ==========================================================================

  /** Levels 1-3 teach one thing each (see tutorialFlow.ts) unless already done or skipped. */
  private startTutorial() {
    if (this.run) return;
    const flow = new TutorialFlow(this.level.id, tutorialStore);
    if (!flow.active) return;
    this.tutorial = new Tutorial(flow);
    const cur = this.session.current;
    if (flow.step === 'place' && cur !== null) {
      // The solver directly: session.hint() would count as an assist.
      const h = hintFor(this.level, this.session.placements, [...this.session.queue], cur);
      if (h.kind !== 'stuck') {
        this.placeTarget = { shelf: h.shelf, slot: h.slot, slots: PACKAGE_SPECS[this.level.packages[cur]].slots };
      }
    }
  }

  private updateTutorial(dtMs: number) {
    const tut = this.tutorial;
    if (!tut) return;
    const s = this.session;
    tut.update({
      dtMs,
      holding: this.interaction.holding !== null,
      hazard: s.hazard.kind !== null,
      reducedMotion: document.documentElement.classList.contains('reduced-motion'),
      pointOf: this.viewLive ? (target) => this.view.clientPointOf(target) : null,
      live: s.current,
      placeTarget: this.placeTarget,
      stowed: s.placements[0]?.id ?? null,
      ghostNeedle: () => this.meter.ghostAnchor(),
    });
    // The guide's card and the level tip share a spot; the guide wins.
    if (tut.step) this.tip?.dismiss();
    if (!tut.alive) this.tutorial = null;
  }

  /**
   * The first time a heavy, fragile, long or priority package is the live
   * belt package - in any mode and level - one short explainer, once ever.
   */
  private explainNewCargo() {
    const cur = this.session.current;
    if (cur === null || this.session.phase === 'won' || this.session.phase === 'failed') return;
    const type = this.level.packages[cur];
    if (!isExplained(type) || progress.tutorial.seenCargo.includes(type)) return;
    progress.markCargoSeen(type);
    this.tip?.dismiss();
    this.cargoTip?.dismiss();
    this.cargoTip = new TipCard(t(`cargo.${type}.first`), 6500, 'cargo-first');
  }

  private refreshUi() {
    this.refreshUndo();
    const s = this.session;
    const ev = s.evaluation;
    this.meter.setValue(ev.net, ev.leftTorque, ev.rightTorque, ev.status);
    this.hud.setRemaining(s.remaining, this.level.packages.length);
    const blocker = s.blockReason();
    this.hud.setObjective(blocker ? blockText(blocker) : this.objective());
  }

  /** The shipment's objective line: the campaign level's own, or the Endless wave's. */
  private objective(): string {
    if (this.run) return t('wave.objective', { n: this.level.packages.length, limit: fmt(this.level.balanceTolerance) });
    return levelText(this.level.id, 'objective', this.level.objective);
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
    if (this.viewLive) {
      this.view.update(animMs);
      this.interaction.update();
    }
    this.meter.tick(animMs);
    this.updateTutorial(animMs);
    if (this.session.phase !== 'play') return;

    const r = this.session.advance(realMs);
    this.showHazard(r, realMs);
    if (r.outcome) this.onOutcome(r.outcome);
  };

  private showHazard(r: TickResult, dt: number) {
    const hazard = r.hazard;
    if (hazard.kind) {
      this.tip?.dismiss();
      this.cargoTip?.dismiss();
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
    this.tutorial?.end();
    this.tutorial = null;
    this.cargoTip?.dismiss();
    this.refreshUndo();
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
    if (this.session.queue.length === 0) {
      this.hud.toast(t('toast.allStowed'), 'info');
      return;
    }
    // A second finger on HINT mid-drag: the package goes back first, and a
    // selection is let go (the session refuses hints while one is held).
    this.interaction.reset();
    requestHint(() => this.applyHint());
  }

  private applyHint() {
    const current = this.session.current;
    const hint = this.session.hint();
    if (current === null || !hint) return;
    if (hint.kind === 'stuck') {
      this.hud.toast(t('toast.stuck'), 'info');
      return;
    }
    // The view clears it after HINT_MS or when a drag begins (GameView.showHint).
    if (this.viewLive) this.view.showHint(current, { shelf: hint.shelf, slot: hint.slot });
    if (hint.kind === 'rearrange') this.hud.toast(t('toast.rearrange'), 'info');
  }

  private clearHint() {
    if (this.viewLive) this.view.clearHint();
  }

  // ==========================================================================
  // Undo
  // ==========================================================================

  /**
   * UNDO is shown available while the shipment is on (a pause does not end
   * it), the free undo is unused and there is a committed move to take back.
   * A package in hand or selected does not grey it out: pressing it puts that
   * package back first.
   */
  private refreshUndo() {
    const snap = this.session.snapshot();
    const on = snap.phase === 'play' || snap.phase === 'paused';
    const ready = on && snap.undoLeft > 0 && snap.undo !== null;
    this.undoBtn.classList.toggle('off', !ready);
    this.undoBtn.setAttribute('aria-disabled', String(!ready));
  }

  private onUndo() {
    const s = this.session;
    if (s.phase !== 'play') return;
    if (s.undoLeft <= 0) {
      this.hud.toast(t('toast.undoUsed'), 'info');
    } else if (s.snapshot().undo === null) {
      this.hud.toast(t('toast.nothingToUndo'), 'info');
    } else {
      // A second finger on UNDO mid-drag: the package goes back and a selection is let go
      // first (undo needs empty hands). A refused press above leaves them alone.
      this.interaction.reset();
      if (s.undo()) {
        this.clearHint();
        // sync() moves every package to its restored place with a short, quiet tween.
        this.refresh();
        this.hud.toast(t('toast.undone'), 'info');
        audio.pickup();
        haptics.tap();
      }
    }
    this.refreshUndo();
  }

  // ==========================================================================
  // Resolution
  // ==========================================================================

  private endHazardUi() {
    this.clearHint();
    this.hud.hideHazard();
    this.dangerEl.classList.remove('on');
  }

  /** Plays an outcome on the current view and remembers it for any view mounted later. */
  private showOutcome(look: (view: GameView) => void) {
    this.outcomeLook = look;
    if (this.viewLive) look(this.view);
  }

  private winLevel(o: ShipmentOutcome) {
    this.endHazardUi();
    const stars = campaignStars(o);
    const previousBest = progress.bestBalanceFor(this.level.id);
    const record = progress.recordWin(this.level.id, stars, o.imbalance);

    audio.win();
    haptics.win();
    if (this.viewLive) this.view.celebrate();

    const id = this.level.id;
    this.after(520, () => {
      new WinPanel(
        {
          levelId: id,
          stars,
          imbalance: o.imbalance,
          tolerance: o.limit,
          packages: this.level.packages.length,
          hints: o.assists.hints,
          undos: o.assists.undos,
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
      this.offerTwoD();
    });
  }

  /**
   * The loss panel states what really happened, from the rules' failure
   * facts: the imbalance against the limit and the lean, the shelf's load
   * against its rating, or the heavy crate above the fragile one. The view
   * points at the shelf or the packages involved, during the fall and behind
   * the panel.
   */
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
      const lean = f?.net ?? net;
      detail = t('fail.detail.collapse', {
        imbalance: fmt(imbalance),
        limit: fmt(tolerance),
        side: lean > 0 ? t('fail.side.right') : t('fail.side.left'),
      });
      audio.collapse();
      haptics.crash();
      this.flash();
      const dir = lean >= 0 ? 1 : -1;
      this.showOutcome((v) => v.failCollapse(dir));
    } else if (f.kind === 'overload') {
      reason = 'overload';
      detail = t('fail.detail.overload', { shelf: shelfName(f.tier, this.level.shelves.length), load: f.load, max: f.max });
      audio.collapse();
      haptics.crash();
      const tier = f.tier;
      const dir = net >= 0 ? 1 : -1;
      this.showOutcome((v) => {
        v.failOverload(tier, dir);
        v.highlight({ shelf: tier });
      });
    } else {
      reason = 'fragile';
      const weight = Math.max(0, ...f.crusherIds.map((id) => PACKAGE_SPECS[this.level.packages[id]].weight));
      const tier = o.placements.find((p) => p.id === f.fragileId)?.shelf ?? 0;
      detail = t('fail.detail.fragile', { weight, shelf: shelfName(tier, this.level.shelves.length, 'on') });
      audio.shatter();
      haptics.crash();
      const id = f.fragileId;
      const crushers = [...f.crusherIds];
      this.showOutcome((v) => {
        v.failFragile(id);
        v.highlight({ cargo: id, others: crushers });
      });
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
            detail,
            // A run is assisted once any rewarded wave used help, or this last wave did.
            assisted: run.assisted || o.assists.hints > 0 || o.assists.undos > 0,
          },
          {
            // Same seed and configuration, but a new run (new runId): wave 1 again.
            onRetrySame: () => this.goto((c) => gameScreen(c, { run: newRun(run.seed) })),
            onNewShift: () => this.goto((c) => gameScreen(c, { run: newRun() })),
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

  /**
   * Between shipments only: if 3D has been struggling even at its lowest
   * quality, offer the 2D view once per app run. Never switches by itself.
   * `then` runs after either choice (Endless uses it to deal the next wave).
   */
  private offerTwoD(then?: () => void): boolean {
    const app = this.ctx.app;
    const stage = this.ctx.host.stageOrNull;
    if (!stage || stage.mode !== '3d' || !stage.struggling || app.slowSuggestionShown) return false;
    app.slowSuggestionShown = true;
    this.suggestion = new SuggestCard(t('render.slowSuggest'), [
      {
        label: t('render.switchTo2d'),
        role: 'switch-2d',
        style: 'primary',
        onPick: () => void app.switchRenderMode('2d', { persist: true }).then(() => then?.()),
      },
      { label: t('render.keep3d'), role: 'keep-3d', style: 'secondary', onPick: () => then?.() },
    ]);
    return true;
  }

  // ==========================================================================
  // Endless
  // ==========================================================================

  private waveIntro(): string {
    const run = this.run;
    if (!run) return '';
    const note = (WAVE_NOTES as readonly number[]).includes(run.wave) ? t(`wave.intro.${run.wave}` as WaveNoteKey) : null;
    const grace = (GRACE_MS.balance * this.graceScale) / 1000;
    const stats =
      t('wave.stats', {
        packages: this.level.packages.length,
        tiers: this.level.shelves.length,
        limit: fmt(this.level.balanceTolerance),
      }) + (this.graceScale < 0.99 ? t('wave.statsGrace', { secs: fmt(grace) }) : '');
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
    if (this.viewLive) {
      this.view.celebrate();
      this.view.dispatch({ onEach: () => audio.pickup() });
    }
    this.dispatched = true;
    // The rack is empty now: the readouts follow.
    this.meter.setValue(0, 0, 0, 'stable');
    this.hud.setObjective(this.objective());
    this.hud.setRemaining(0, this.level.packages.length);
    this.waveCard = new WaveClearCard(result, run.wave);

    // A pending "try 2D?" choice holds the next wave until it is answered.
    const asked = this.offerTwoD(() => this.advanceWave());
    this.after(700, () => {
      if (this.advancing) return;
      const surface = this.surface;
      const tap = () => {
        this.suggestion?.dismiss();
        this.advanceWave();
      };
      surface.addEventListener('pointerdown', tap, { once: true });
      this.offAdvanceTap = () => surface.removeEventListener('pointerdown', tap);
    });
    if (!asked) this.after(2400, () => this.advanceWave());
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

  private openLegend() {
    if (this.legendOpen || this.pausePanel || this.session.phase !== 'play') return;
    // Opening a panel mid-drag puts the package back; the rules clocks stop while it is open.
    this.interaction.cancel();
    this.pauses.add('legend');
    this.legendOpen = true;
    new LegendPanel(() => {
      this.legendOpen = false;
      this.pauses.remove('legend');
    });
  }

  /** Pause panel: also reachable while held by another reason (a switch, a lost context). */
  private openPause() {
    const phase = this.session.phase;
    if (this.pausePanel || this.legendOpen || (phase !== 'play' && phase !== 'paused')) return;
    this.interaction.cancel();
    this.pauses.add('menu');
    const closed = () => {
      this.pausePanel = null;
    };
    this.pausePanel = new PausePanel({
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
        closed();
        this.pauses.remove('menu');
      },
      restartLabel: this.run ? t('pause.endRun') : t('pause.restartLevel'),
      exitLabel: this.run ? t('pause.mainMenu') : t('pause.levelSelect'),
      onRestart: () => {
        closed();
        if (this.run) this.goto(menuScreen);
        else this.restartLevel();
      },
      onExit: () => {
        closed();
        this.goto(this.run ? menuScreen : levelSelectScreen);
      },
      view: viewControls(this.ctx),
    });
  }
}
