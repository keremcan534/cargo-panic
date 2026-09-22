/**
 * Owns the app's one Stage and is the ONLY code that writes `loop.stage`.
 *
 * `switchTo(mode)` replaces the stage under whatever screen is showing:
 *   1-2. the screen drops everything it built from the old stage
 *        (hooks.detach: the game cancels any drag and disposes its view,
 *        a menu disposes its backdrop);
 *   3.   the old stage is disposed (canvas removed, WebGL context released,
 *        listeners and tweens gone) and the loop draws nothing meanwhile;
 *   4.   the new stage is created (3D may fall back to 2D, see createStage);
 *   5.   loop.stage = the new stage;
 *   6.   the screen rebuilds on it (hooks.attach).
 * So two renderers never draw at once and only one canvas is ever live.
 *
 * Switches are serialised. A request made while one is running is queued
 * (the latest wins) and every caller gets the final result. Each request
 * bumps a generation counter; a stage whose creation resolves after a newer
 * request was made is stale and disposes itself immediately without ever
 * going live. `busy` is true from the request until the last queued switch
 * has finished, and `idle` resolves then (the Router waits for it before
 * changing screens).
 *
 * `mode` is the effective renderer. The player's stored preference lives in
 * the save (progress.settings.renderMode) and can differ - e.g. 3D preferred
 * but the device could not start it.
 */

import { createStage } from '../render/createStage';
import type { CreatedStage } from '../render/createStage';
import type { RenderMode } from '../render/GameView';
import type { Stage, StageContextEvent, StageOptions } from '../render/Stage';

export interface SwitchResult {
  /** The mode that was asked for. */
  requested: RenderMode;
  /** The mode now drawing (2D when 3D could not start). */
  mode: RenderMode;
  /** 3D was requested and could not start. */
  fellBack: boolean;
}

/** What the host needs from the current screen around a stage swap. */
export interface StageScreenHooks {
  /** Steps 1-2: drop everything built from the old stage. */
  detach(): void;
  /** Step 6: rebuild on the new stage. */
  attach(stage: Stage, result: SwitchResult): void;
}

export type HostEvent =
  | { type: 'busy'; busy: boolean }
  | { type: 'switched'; result: SwitchResult }
  | { type: 'context'; event: StageContextEvent; stage: Stage };

export type StageCreator = (mode: RenderMode, root: HTMLElement, opts: StageOptions) => Promise<CreatedStage>;

/** The one field of FrameLoop the host writes. */
export interface StageSlot {
  stage: Stage | null;
}

const NO_HOOKS: StageScreenHooks = { detach() {}, attach() {} };

export class StageHost {
  private current: Stage | null = null;
  private lastMode: RenderMode | null = null;
  private generationValue = 0;
  private request: RenderMode | null = null;
  private running: Promise<SwitchResult> | null = null;
  private lastResult: SwitchResult | null = null;
  private offContext: (() => void) | null = null;
  private hooks: StageScreenHooks = NO_HOOKS;
  private listeners = new Set<(e: HostEvent) => void>();

  constructor(
    private readonly loop: StageSlot,
    private readonly root: HTMLElement,
    private readonly options: () => StageOptions,
    private readonly create: StageCreator = createStage,
  ) {}

  /** The live stage. Throws between boot and the first stage, and while a switch has none live. */
  get stage(): Stage {
    if (!this.current) throw new Error('no stage is live (booting or switching)');
    return this.current;
  }

  /** The live stage, or null mid-switch. */
  get stageOrNull(): Stage | null {
    return this.current;
  }

  /** Effective renderer: the live stage's mode (mid-switch, the last one that was live). */
  get mode(): RenderMode {
    return this.current?.mode ?? this.lastMode ?? '2d';
  }

  get busy(): boolean {
    return this.running !== null;
  }

  /** Resolves once no switch is running or queued (immediately when idle). */
  get idle(): Promise<void> {
    return this.running ? this.running.then(noop, noop) : Promise.resolve();
  }

  /** Bumped by every request; tests read it. */
  get generation(): number {
    return this.generationValue;
  }

  get last(): SwitchResult | null {
    return this.lastResult;
  }

  /** The app routes these to the current screen (see App). */
  setScreenHooks(hooks: StageScreenHooks) {
    this.hooks = hooks;
  }

  onEvent(cb: (e: HostEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** First stage, before any screen exists. */
  boot(mode: RenderMode): Promise<SwitchResult> {
    return this.switchTo(mode);
  }

  /** Replaces the stage (sequence in the file comment). Resolves with the final result once idle. */
  switchTo(mode: RenderMode): Promise<SwitchResult> {
    this.generationValue++;
    this.request = mode;
    if (!this.running) {
      const run = this.drain().finally(() => {
        this.running = null;
        this.emit({ type: 'busy', busy: false });
      });
      this.running = run;
      this.emit({ type: 'busy', busy: true });
    }
    return this.running;
  }

  private async drain(): Promise<SwitchResult> {
    let result: SwitchResult | null = null;
    while (this.request !== null) {
      const mode = this.request;
      const generation = this.generationValue;
      this.request = null;
      if (this.current) this.retire();
      const made = await this.create(mode, this.root, this.options());
      if (generation !== this.generationValue) {
        // Superseded while it was being made: it never goes live.
        made.stage.dispose();
        continue;
      }
      this.adopt(made.stage);
      result = { requested: mode, mode: made.stage.mode, fellBack: made.fellBack };
      this.lastResult = result;
      try {
        this.hooks.attach(made.stage, result);
      } catch (e) {
        console.error('[cargo-panic] screen could not attach to the new stage', e);
      }
      this.emit({ type: 'switched', result });
    }
    if (!result) throw new Error('stage switch finished without a stage');
    return result;
  }

  /** Steps 1-3 and the loop's half of 5: the screen lets go, the loop stops drawing it, it is disposed. */
  private retire() {
    const old = this.current;
    if (!old) return;
    try {
      this.hooks.detach();
    } catch (e) {
      console.error('[cargo-panic] screen could not detach from the stage', e);
    }
    this.offContext?.();
    this.offContext = null;
    this.current = null;
    this.loop.stage = null;
    old.dispose();
  }

  private adopt(stage: Stage) {
    this.current = stage;
    this.lastMode = stage.mode;
    this.loop.stage = stage;
    this.offContext = stage.onContextEvent((event) => {
      if (this.current === stage) this.emit({ type: 'context', event, stage });
    });
  }

  private emit(e: HostEvent) {
    for (const cb of [...this.listeners]) {
      try {
        cb(e);
      } catch (err) {
        console.error('[cargo-panic] stage host listener failed', err);
      }
    }
  }
}

function noop() {}
