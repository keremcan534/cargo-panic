/**
 * One renderer, one UI root, one active screen at a time. Screens build their
 * 3D objects into `ctx.renderer.scene` and their DOM into `#ui-root`, and tear
 * both down on exit.
 */

import type { Renderer } from '../render/Renderer';
import { uiRoot } from '../ui/dom';

export interface Screen {
  enter(): void;
  exit(): void;
}

export interface AppContext {
  renderer: Renderer;
  router: Router;
}

export type ScreenFactory = (ctx: AppContext) => Screen;

export class Router {
  private current: Screen | null = null;
  readonly ctx: AppContext;

  constructor(renderer: Renderer) {
    this.ctx = { renderer, router: this };
  }

  go(factory: ScreenFactory) {
    this.current?.exit();
    // Anything a screen forgot to clean up goes with it.
    uiRoot().replaceChildren();
    this.ctx.renderer.tweens.clear();
    this.current = factory(this.ctx);
    this.current.enter();
  }
}
