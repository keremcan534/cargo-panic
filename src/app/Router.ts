/**
 * One stage, one UI root, one active screen at a time. Screens get their 3D
 * (or 2D) content from `ctx.stage` and build their DOM into `#ui-root`; on
 * exit each screen disposes what it was given. The router only wipes the UI
 * root and the tween clock as a safety net.
 *
 * Screens never change while the stage is being swapped: `go` during a
 * switch waits for the host to be idle (and only the latest request runs).
 */

import type { RenderMode } from '../render/GameView';
import type { Stage } from '../render/Stage';
import { uiRoot } from '../ui/dom';
import type { App } from './App';
import type { FrameLoop } from './FrameLoop';
import type { StageHost, SwitchResult } from './StageHost';

export interface Screen {
  enter(): void;
  exit(): void;
  /**
   * The stage is about to be replaced (view switch or a fallback to 2D):
   * drop everything built from it - a game cancels any drag and disposes its
   * view, a menu disposes its backdrop. The screen's DOM stays.
   */
  detachStage?(): void;
  /** The new stage is live: rebuild on it (a game remounts the same session). */
  attachStage?(stage: Stage, result: SwitchResult): void;
  /** The 3D context was lost: stop the clocks and input until it is back or replaced. */
  stageLost?(): void;
  /** The lost context came back in time. */
  stageRestored?(): void;
}

export interface AppContext {
  readonly app: App;
  readonly router: Router;
  readonly host: StageHost;
  /** The live stage (host.stage). Read it when needed; a view switch replaces it. */
  readonly stage: Stage;
  /** The renderer drawing now (may be 2D while the stored preference is 3D). */
  readonly mode: RenderMode;
  readonly loop: FrameLoop;
}

export type ScreenFactory = (ctx: AppContext) => Screen;

export class Router {
  private currentScreen: Screen | null = null;
  private pending: ScreenFactory | null = null;
  readonly ctx: AppContext;

  constructor(app: App) {
    this.ctx = {
      app,
      router: this,
      host: app.host,
      get stage() {
        return app.host.stage;
      },
      get mode() {
        return app.host.mode;
      },
      loop: app.loop,
    };
  }

  get current(): Screen | null {
    return this.currentScreen;
  }

  go(factory: ScreenFactory) {
    const host = this.ctx.host;
    if (host.busy) {
      // Mid-switch: change screens once the new stage is live.
      const first = this.pending === null;
      this.pending = factory;
      if (first) {
        void host.idle.then(() => {
          const next = this.pending;
          this.pending = null;
          if (next) this.go(next);
        });
      }
      return;
    }
    this.currentScreen?.exit();
    // Anything a screen forgot to clean up goes with it.
    uiRoot().replaceChildren();
    this.ctx.stage.tweens.clear();
    this.currentScreen = factory(this.ctx);
    this.currentScreen.enter();
  }
}
