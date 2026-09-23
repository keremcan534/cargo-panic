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
 *
 * And the app lifecycle (wired to platform/lifecycle.ts in main.ts): `hide`
 * when the player leaves (the screen pauses and saves, sound stops, the save
 * is written now), `show` when they are back (nothing resumes by itself),
 * `back` for the Android back button.
 */

import { audio } from '../game/systems/AudioManager';
import { progress } from '../game/systems/ProgressManager';
import type { LanguagePref } from '../game/save/schema';
import { getLanguage, t } from '../i18n';
import type { RenderMode } from '../render/GameView';
import type { QualityPref, Stage } from '../render/Stage';
import { showNotice } from '../ui/Notice';
import { closeSaveMessage } from '../ui/SaveNotices';
import { FrameLoop } from './FrameLoop';
import { applyLanguage, applyMotionClass, effectiveReducedMotion, onSystemMotionChange } from './Preferences';
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
  /** In the background (from a lifecycle hide until show). A game entered meanwhile starts paused. */
  hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  private lostTimer = 0;
  /** The stage whose lost context is being waited for. */
  private lostStage: Stage | null = null;

  constructor(host: StageHost, loop: FrameLoop = new FrameLoop()) {
    this.host = host;
    this.loop = loop;
    this.router = new Router(this);
    host.setScreenHooks({
      detach: () => this.router.current?.detachStage?.(),
      attach: (stage, result) => this.router.current?.attachStage?.(stage, result),
    });
    host.onEvent((e) => this.onHostEvent(e));
    // "System" follows the device live: a change there reaches the running game.
    onSystemMotionChange(() => this.applyReducedMotion());
    this.applyReducedMotion();
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
   * The player left (tab hidden, screen locked, app in the background). The
   * current screen lets go of any package, pauses and saves; sound stops;
   * the save is written now. The frame loop draws nothing while hidden and
   * never charges the gap (FrameLoop), so frame-clock delays freeze too.
   */
  hide() {
    if (this.hidden) return;
    this.hidden = true;
    this.router.current?.hide?.();
    audio.suspend();
    progress.flush();
    // A lost 3D context gets its full wait once the app is back in front.
    window.clearTimeout(this.lostTimer);
    this.lostTimer = 0;
  }

  /** Back in front: sound may play again. Nothing resumes by itself - a paused game waits for RESUME. */
  show() {
    if (!this.hidden) return;
    this.hidden = false;
    audio.resume();
    this.loop.resync();
    if (this.lostStage && !this.lostTimer) this.waitForContext(this.lostStage);
  }

  /**
   * Android back button: acknowledges a save message on screen, else the
   * current screen handles it, or (false) the native layer exits the app.
   */
  back(): boolean {
    if (closeSaveMessage()) return true;
    return this.router.current?.back?.() ?? false;
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

  /** Stores the reduced-motion choice (null = follow the system) and applies it now. */
  setReducedMotion(pref: boolean | null) {
    if (progress.settings.reducedMotion !== pref) progress.setReducedMotion(pref);
    this.applyReducedMotion();
  }

  /** The value in force: the <html> class for CSS, and the live stage (a new stage reads it at creation). */
  applyReducedMotion() {
    const on = effectiveReducedMotion();
    applyMotionClass(on);
    this.host.stageOrNull?.setReducedMotion(on);
  }

  /**
   * Stores the language choice (null = follow the device) and applies it. If
   * the text language changed, the current screen re-renders its DOM.
   */
  setLanguage(pref: LanguagePref | null) {
    if (progress.settings.language !== pref) progress.setLanguage(pref);
    const before = getLanguage();
    if (applyLanguage() !== before) this.router.current?.languageChanged?.();
  }

  private onHostEvent(e: HostEvent) {
    if (e.type !== 'context') return;
    if (e.event === 'lost') {
      this.router.current?.stageLost?.();
      this.waitForContext(e.stage);
      return;
    }
    window.clearTimeout(this.lostTimer);
    this.lostTimer = 0;
    this.lostStage = null;
    this.router.current?.stageRestored?.();
  }

  /** Gives a lost context CONTEXT_RESTORE_MS of time in front (none of it runs while hidden). */
  private waitForContext(stage: Stage) {
    window.clearTimeout(this.lostTimer);
    this.lostTimer = 0;
    this.lostStage = stage;
    if (this.hidden) return;
    this.lostTimer = window.setTimeout(() => void this.fallBackAfterLoss(stage), CONTEXT_RESTORE_MS);
  }

  /** The context did not come back: same path as a switch, not stored as the player's choice. */
  private async fallBackAfterLoss(lost: Stage) {
    this.lostTimer = 0;
    this.lostStage = null;
    if (this.host.stageOrNull !== lost) return; // already replaced
    await this.host.switchTo('2d');
    showNotice(t('render.fallback2d'));
  }
}
