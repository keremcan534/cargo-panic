/**
 * App lifecycle in one place: "the player left" and "the player is back",
 * plus the Android back button.
 *
 * Web: `visibilitychange`, `pagehide` and `freeze` (Chrome's page lifecycle)
 * mean hidden; `visibilitychange` back to visible means shown. Both can fire
 * for one departure, so events are de-duplicated into clean hide/show edges.
 *
 * Native (Capacitor): when the app runs inside a Capacitor shell that has the
 * App plugin installed, `appStateChange` and `backButton` are used as well.
 * This project does not ship the plugin yet; the hook is detected at runtime
 * and simply absent in the browser. It has NOT been exercised on a device.
 */

export interface LifecycleHandlers {
  /** The app is going to the background, the screen locked, or the tab was hidden. */
  onHide(): void;
  /** The app is visible again. Nothing resumes by itself; this only reports it. */
  onShow(): void;
  /** Android back button (native only). Return true if handled. */
  onBack?(): boolean;
}

interface CapacitorAppPlugin {
  addListener(
    event: 'appStateChange' | 'backButton',
    cb: (e: { isActive?: boolean; canGoBack?: boolean }) => void,
  ): Promise<{ remove(): void }> | { remove(): void };
  exitApp?(): void;
}

function nativeApp(): CapacitorAppPlugin | null {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { App?: CapacitorAppPlugin } } })
    .Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return cap.Plugins?.App ?? null;
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

  const removers: (() => void)[] = [];
  const app = nativeApp();
  if (app) {
    const keep = (r: Promise<{ remove(): void }> | { remove(): void }) => {
      void Promise.resolve(r).then((handle) => removers.push(() => handle.remove()));
    };
    keep(app.addListener('appStateChange', (e) => (e.isActive ? show() : hide())));
    keep(
      app.addListener('backButton', () => {
        if (!h.onBack?.()) app.exitApp?.();
      }),
    );
  }

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', hide);
    document.removeEventListener('freeze', hide);
    window.removeEventListener('pageshow', onVisibility);
    for (const r of removers) r();
  };
}
