/**
 * Entry point. Reads the player's view preference, makes the one Stage for
 * it through the StageHost (three.js is only loaded, by dynamic import, when
 * that preference is 3D - see render/createStage.ts), then starts the frame
 * loop and the screens. Then the save notices (anything the player must
 * know about their save) and the app lifecycle: hidden / shown / Android
 * back go to App (see platform/lifecycle.ts). Plus the browser gesture
 * lockdown a full-screen touch game needs.
 *
 * Nothing in this module's static import graph reaches three.js; the
 * architecture test checks that.
 */

import './style.css';
import { App } from './app/App';
import { FrameLoop } from './app/FrameLoop';
import { StageHost } from './app/StageHost';
import { audio } from './game/systems/AudioManager';
import { progress } from './game/systems/ProgressManager';
import { t } from './i18n';
import { applyLanguage, effectiveReducedMotion } from './app/Preferences';
import { watchLifecycle } from './platform/lifecycle';
import type { RenderMode } from './render/GameView';
import type { ScreenRect, StageOptions } from './render/Stage';
import type { ThreeStage } from './render/three/ThreeStage';
import { showNotice } from './ui/Notice';
import { showBootNotices, watchSaveHealth } from './ui/SaveNotices';
import { splashScreen } from './ui/Splash';

function stageOptions(): StageOptions {
  return { reducedMotion: effectiveReducedMotion(), quality: progress.settings.quality };
}

function debugHooksEnabled(): boolean {
  return import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e');
}

interface AppProbe {
  /** Renderer drawing now. */
  readonly mode: RenderMode;
  /** The player's stored preference. */
  readonly preference: RenderMode;
  readonly busy: boolean;
  /** Stage switches requested so far. */
  readonly generation: number;
  readonly frames: number;
  readonly loopSubscribers: number;
  readonly canvases: number;
  /** The live stage has been slow even at its lowest quality (3D only). */
  readonly struggling: boolean;
  /** 3D quality in force, or null in 2D. */
  readonly quality: ThreeStage['quality'] | null;
  /** Reduced motion as the live stage has it (null mid-switch). */
  readonly reducedMotion: boolean | null;
  /** The app is in the background as far as the lifecycle is concerned. */
  readonly hidden: boolean;
  /** Where the title screen's hero rack is drawn (CSS px), or null when it is not. */
  readonly heroRect: ScreenRect | null;
}

declare global {
  interface Window {
    __cargoPanicApp?: AppProbe;
    __cargoPanicGpu?: () => Record<string, number | string>;
  }
}

async function boot() {
  // The text language (saved choice, else the device's) before anything is drawn.
  applyLanguage();
  const root = document.getElementById('game-root') as HTMLElement;
  const loop = new FrameLoop();
  const host = new StageHost(loop, root, stageOptions);
  const first = await host.boot(progress.settings.renderMode);
  const app = new App(host, loop);

  // Retire the pre-render HTML splash now that we can paint.
  const bootSplash = document.getElementById('boot-splash');
  if (bootSplash) {
    bootSplash.classList.add('hidden');
    window.setTimeout(() => bootSplash.remove(), 500);
  }

  app.start();
  app.router.go(splashScreen);
  // 3D was preferred but could not start: say so once; the preference stays 3D.
  if (first.fellBack) showNotice(t('render.fallback2d'));
  // What happened to the save while loading (recovered, unreadable, ...), then the live "cannot save" banner.
  showBootNotices(progress.takeSaveNotices());
  watchSaveHealth();
  // Web: visibilitychange / pagehide / freeze. Native (Capacitor App plugin, not installed yet): state and back button.
  watchLifecycle({
    onHide: () => app.hide(),
    onShow: () => app.show(),
    onBack: () => app.back(),
  });

  if (debugHooksEnabled()) {
    window.__cargoPanicApp = Object.freeze({
      get mode() {
        return host.mode;
      },
      get preference() {
        return progress.settings.renderMode;
      },
      get busy() {
        return host.busy;
      },
      get generation() {
        return host.generation;
      },
      get frames() {
        return loop.frames;
      },
      get loopSubscribers() {
        return loop.subscribers;
      },
      get canvases() {
        return document.querySelectorAll('canvas').length;
      },
      get struggling() {
        return host.stageOrNull?.struggling ?? false;
      },
      get quality() {
        const stage = host.stageOrNull;
        return stage?.mode === '3d' ? (stage as ThreeStage).quality : null;
      },
      get reducedMotion() {
        const stage = host.stageOrNull as { reducedMotion?: boolean } | null;
        return stage?.reducedMotion ?? null;
      },
      get hidden() {
        return app.hidden;
      },
      get heroRect() {
        return host.stageOrNull?.heroRect?.() ?? null;
      },
    });
    // GPU resource counts, to catch leaks across screens (3D only; 2D reports the mode and frames).
    window.__cargoPanicGpu = (): Record<string, number | string> => {
      const stage = host.stageOrNull;
      if (!stage || stage.mode !== '3d') return { mode: host.mode, frames: loop.frames };
      const three = stage as ThreeStage;
      return {
        mode: '3d',
        geometries: three.gl.info.memory.geometries,
        textures: three.gl.info.memory.textures,
        programs: three.gl.info.programs?.length ?? 0,
        sceneChildren: three.scene.children.length,
        frames: loop.frames,
      };
    };
  }
}

void boot().catch((e) => {
  console.error('[cargo-panic] could not start', e);
});

// --- browser gesture lockdown ----------------------------------------------
const stop = (e: Event) => e.preventDefault();
document.addEventListener('contextmenu', stop);
document.addEventListener('gesturestart', stop);
document.addEventListener('gesturechange', stop);
document.addEventListener('selectstart', stop);
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 320) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false },
);

// --- audio unlock ------------------------------------------------------------
// (Back from the background, App.show resumes the audio context.)
window.addEventListener('pointerdown', () => audio.unlock());
window.addEventListener('keydown', () => audio.unlock());
