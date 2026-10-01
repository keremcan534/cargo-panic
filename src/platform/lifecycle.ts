/**
 * App lifecycle in one place: "the player left" and "the player is back",
 * plus the Android back button.
 *
 * Web: `visibilitychange`, `pagehide` and `freeze` (Chrome's page lifecycle)
 * mean hidden; `visibilitychange` back to visible means shown. Both can fire
 * for one departure, so events are de-duplicated into clean hide/show edges.
 *
 * Native (the Capacitor Android shell): the shell's bridge defines
 * `window.Capacitor` before the page runs, with `isNativePlatform()` true.
 * Only then is the @capacitor/app plugin loaded - by dynamic import, so the
 * web build's entry chunk does not carry it - and its `appStateChange` and
 * `backButton` events are used as well. Registering a `backButton` listener
 * turns off the WebView's own back handling: App.back() decides, and when it
 * does not handle the press (the bare title screen) the app exits.
 * This has NOT been exercised on a device or emulator.
 */

import type { PluginListenerHandle } from '@capacitor/core';

export interface LifecycleHandlers {
  /** The app is going to the background, the screen locked, or the tab was hidden. */
  onHide(): void;
  /** The app is visible again. Nothing resumes by itself; this only reports it. */
  onShow(): void;
  /** Android back button (native only). Return true if handled. */
  onBack?(): boolean;
}

type Handle = Pick<PluginListenerHandle, 'remove'>;

/** The part of @capacitor/app's `App` used here. */
export interface NativeAppApi {
  addListener(event: 'appStateChange', cb: (e: { isActive: boolean }) => void): Promise<Handle> | Handle;
  addListener(event: 'backButton', cb: (e: { canGoBack: boolean }) => void): Promise<Handle> | Handle;
  exitApp(): Promise<void> | void;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: { App?: NativeAppApi };
}

/** The App plugin inside the native shell, or null in a browser. */
async function nativeApp(): Promise<NativeAppApi | null> {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  // Already registered (by an earlier import, or a test double): use it as is.
  if (cap.Plugins?.App) return cap.Plugins.App;
  const { App } = await import('@capacitor/app');
  return App;
}

/** Starts watching. Returns a function that removes every listener. */
export function watchLifecycle(h: LifecycleHandlers): () => void {
  let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  const hide = () => {
    if (hidden) return;
    hidden = true;
    h.onHide();
  };
  const show = () => {
    if (!hidden) return;
    hidden = false;
    h.onShow();
  };
  const onVisibility = () => (document.visibilityState === 'hidden' ? hide() : show());

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', hide);
  document.addEventListener('freeze', hide);
  window.addEventListener('pageshow', onVisibility);

  let stopped = false;
  const removers: (() => void)[] = [];
  const keep = (r: Promise<Handle> | Handle) => {
    void Promise.resolve(r).then((handle) => {
      if (stopped) void handle.remove();
      else removers.push(() => void handle.remove());
    });
  };
  void nativeApp()
    .then((app) => {
      if (!app || stopped) return;
      keep(app.addListener('appStateChange', (e) => (e.isActive ? show() : hide())));
      keep(
        app.addListener('backButton', () => {
          if (!h.onBack?.()) void app.exitApp();
        }),
      );
    })
    .catch((e) => console.warn('[cargo-panic] native lifecycle unavailable', e));

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', hide);
    document.removeEventListener('freeze', hide);
    window.removeEventListener('pageshow', onVisibility);
    for (const r of removers.splice(0)) r();
  };
}
