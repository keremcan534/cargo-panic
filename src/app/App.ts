/**
 * The application shell: the StageHost (which owns the one Stage), the single
 * FrameLoop that drives it, and the Router that swaps screens. Nothing here
 * knows which renderer the stage is.
 *
 * View switching lives here (`switchRenderMode`) because it spans the host
 * (stage swap) and the current screen (detach / reattach). So does the
 * WebGL context-loss policy: a lost 3D context pauses the screen, and if it
 * is not back within CONTEXT_RESTORE_MS the app falls back to 2D through the
 * same path as a switch, keeping the game session.
 */

import { progress } from '../game/systems/ProgressManager';
import { t } from '../i18n';
import type { RenderMode } from '../render/GameView';
import type { QualityPref, Stage } from '../render/Stage';
import { showNotice } from '../ui/Notice';
import { FrameLoop } from './FrameLoop';
import { Router } from './Router';
import type { AppContext } from './Router';
import type { HostEvent, StageHost, SwitchResult } from './StageHost';

/** How long a lost WebGL context gets to come back before the game moves to 2D. */
export const CONTEXT_RESTORE_MS = 2000;

export class App {
  readonly loop: FrameLoop;
  readonly router: Router;
  readonly host: StageHost;
  /** The "3D is slow, try 2D" suggestion is offered at most once per run of the app. */
  slowSuggestionShown = false;
  private lostTimer = 0;

  constructor(host: StageHost, loop: FrameLoop = new FrameLoop()) {
    this.host = host;
    this.loop = loop;
    this.router = new Router(this);
    host.setScreenHooks({
      detach: () => this.router.current?.detachStage?.(),
      attach: (stage, result) => this.router.current?.attachStage?.(stage, result),
    });
    host.onEvent((e) => this.onHostEvent(e));
  }

  get stage(): Stage {
    return this.host.stage;
  }

  get ctx(): AppContext {
    return this.router.ctx;
  }

  start() {
    this.loop.start();
  }

  /**
   * Switches the renderer under the current screen: the screen detaches, the
   * old stage is disposed, the new one is created (3D falls back to 2D) and
   * the screen reattaches - a game keeps its session and stays paused.
   * `persist` stores the choice as the player's preference; the app's own
   * fallbacks never do. Returns null when there was nothing to switch.
   */
  async switchRenderMode(mode: RenderMode, opts: { persist?: boolean } = {}): Promise<SwitchResult | null> {
    if (opts.persist && progress.settings.renderMode !== mode) progress.setRenderMode(mode);
    if (!this.host.busy && this.host.mode === mode) return null;
    const result = await this.host.switchTo(mode);
    if (result.fellBack) showNotice(t('render.fallback2d'));
    return result;
  }

  /** Stores the 3D quality preference and applies it to the live stage (2D ignores it). */
  setQuality(q: QualityPref) {
    if (progress.settings.quality !== q) progress.setQuality(q);
    this.host.stageOrNull?.setQuality(q);
  }

  private onHostEvent(e: HostEvent) {
    if (e.type !== 'context') return;
    if (e.event === 'lost') {
      this.router.current?.stageLost?.();
      window.clearTimeout(this.lostTimer);
      this.lostTimer = window.setTimeout(() => void this.fallBackAfterLoss(e.stage), CONTEXT_RESTORE_MS);
      return;
    }
    window.clearTimeout(this.lostTimer);
    this.lostTimer = 0;
    this.router.current?.stageRestored?.();
  }

  /** The context did not come back: same path as a switch, not stored as the player's choice. */
  private async fallBackAfterLoss(lost: Stage) {
    this.lostTimer = 0;
    if (this.host.stageOrNull !== lost) return; // already replaced
    await this.host.switchTo('2d');
    showNotice(t('render.fallback2d'));
  }
}
