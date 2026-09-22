/**
 * The application shell: the current Stage, the single FrameLoop that drives
 * it, and the Router that swaps screens. Nothing here knows which renderer
 * the stage is.
 */

import type { Stage } from '../render/Stage';
import { FrameLoop } from './FrameLoop';
import { Router } from './Router';
import type { AppContext } from './Router';

export class App {
  readonly loop: FrameLoop;
  readonly router: Router;
  private currentStage: Stage;

  constructor(stage: Stage, loop: FrameLoop = new FrameLoop()) {
    this.currentStage = stage;
    this.loop = loop;
    this.loop.stage = stage;
    this.router = new Router(this);
  }

  get stage(): Stage {
    return this.currentStage;
  }

  get ctx(): AppContext {
    return this.router.ctx;
  }

  start() {
    this.loop.start();
  }
}
