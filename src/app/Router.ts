/**
 * One stage, one UI root, one active screen at a time. Screens get their 3D
 * (or 2D) content from `ctx.stage` and build their DOM into `#ui-root`; on
 * exit each screen disposes what it was given. The router only wipes the UI
 * root and the tween clock as a safety net.
 */

import type { Stage } from '../render/Stage';
import { uiRoot } from '../ui/dom';
import type { App } from './App';
import type { FrameLoop } from './FrameLoop';

export interface Screen {
  enter(): void;
  exit(): void;
}

export interface AppContext {
  readonly app: App;
  readonly router: Router;
  /** The current stage. Read it when needed; A2 can swap it between screens. */
  readonly stage: Stage;
  readonly loop: FrameLoop;
}

export type ScreenFactory = (ctx: AppContext) => Screen;

export class Router {
  private current: Screen | null = null;
  readonly ctx: AppContext;

  constructor(app: App) {
    this.ctx = {
      app,
      router: this,
      get stage() {
        return app.stage;
      },
      loop: app.loop,
    };
  }

  go(factory: ScreenFactory) {
    this.current?.exit();
    // Anything a screen forgot to clean up goes with it.
    uiRoot().replaceChildren();
    this.ctx.stage.tweens.clear();
    this.current = factory(this.ctx);
    this.current.enter();
  }
}
