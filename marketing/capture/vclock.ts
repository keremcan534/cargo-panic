/**
 * A virtual clock for the game page, installed as a Playwright init script.
 *
 * The page never sees real time: requestAnimationFrame, setTimeout /
 * setInterval, performance.now and Date.now all read one virtual clock that
 * moves only when the capture script calls `window.__vclock.step(ms)`. CSS
 * animations and transitions (Web Animations) are paused and moved by the
 * same step, and Math.random is seeded. So every recorded frame is exactly
 * 1/fps apart however slowly software WebGL draws it, and a re-run draws the
 * same frames.
 *
 * This function is serialised by Playwright: it must not reference anything
 * outside its own body.
 */
export function installVirtualClock(opts: {
  seed: number;
  fonts: { family: string; url: string; range: string }[];
}): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__vclock) return;

  // --- seeded Math.random (mulberry32) -------------------------------------
  let s = opts.seed >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // --- time --------------------------------------------------------------------
  let now = 1000; // ms; never 0 so "last frame" arithmetic in the game is ordinary
  const epoch = Date.UTC(2026, 0, 1);
  performance.now = () => now;
  Date.now = () => epoch + now;

  // --- requestAnimationFrame -----------------------------------------------------
  let rafId = 0;
  let raf = new Map<number, FrameRequestCallback>();
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    raf.set(++rafId, cb);
    return rafId;
  };
  window.cancelAnimationFrame = (id: number) => {
    raf.delete(id);
  };

  // --- timers --------------------------------------------------------------------
  interface Timer {
    id: number;
    due: number;
    every: number | null;
    fn: () => void;
  }
  const realSetTimeout = window.setTimeout.bind(window);
  let timerId = 0;
  const timers = new Map<number, Timer>();
  const add = (fn: unknown, ms: unknown, every: boolean, args: unknown[]) => {
    const delay = Math.max(0, Number(ms) || 0);
    const call = typeof fn === 'function' ? () => (fn as (...a: unknown[]) => void)(...args) : () => undefined;
    const id = ++timerId;
    timers.set(id, { id, due: now + delay, every: every ? Math.max(1, delay) : null, fn: call });
    return id;
  };
  (window as unknown as { setTimeout: unknown }).setTimeout = (fn: unknown, ms?: unknown, ...args: unknown[]) =>
    add(fn, ms, false, args);
  (window as unknown as { setInterval: unknown }).setInterval = (fn: unknown, ms?: unknown, ...args: unknown[]) =>
    add(fn, ms, true, args);
  const clear = (id?: unknown) => {
    if (typeof id === 'number') timers.delete(id);
  };
  (window as unknown as { clearTimeout: unknown }).clearTimeout = clear;
  (window as unknown as { clearInterval: unknown }).clearInterval = clear;

  const flush = () => new Promise<void>((r) => realSetTimeout(r, 0));

  // --- Web Animations (CSS animations and transitions) -----------------------------
  const seen = new WeakSet<Animation>();
  const moveAnimations = (dt: number) => {
    for (const a of document.getAnimations()) {
      if (!seen.has(a)) {
        // Born during this step: it starts at 0 on this frame.
        seen.add(a);
        a.pause();
        a.currentTime = 0;
        continue;
      }
      if (a.playState === 'finished') continue;
      // Once paused from script, Chromium keeps a CSS animation alive after its
      // element stops asking for it (class removed); the browser would have
      // cancelled it, so do that here.
      if (typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation) {
        const fx = a.effect as KeyframeEffect | null;
        const target = fx?.target as Element | null | undefined;
        if (target) {
          const names = getComputedStyle(target, fx?.pseudoElement ?? null).animationName.split(',').map((n) => n.trim());
          if (!target.isConnected || !names.includes(a.animationName)) {
            a.cancel();
            continue;
          }
        }
      }
      a.pause();
      a.currentTime = Number(a.currentTime ?? 0) + dt;
    }
  };

  // --- fonts (FontFace: no <head> exists yet when an init script runs) ----------------
  for (const f of opts.fonts) {
    const face = new FontFace(f.family, `url(${f.url})`, {
      weight: '100 900',
      stretch: '75% 100%',
      unicodeRange: f.range,
      display: 'block',
    });
    document.fonts.add(face);
    void face.load();
  }

  w.__vclock = {
    get now() {
      return now;
    },
    /** Moves the clock by `dt` ms: due timers in order, then one animation frame. */
    async step(dt: number) {
      const target = now + dt;
      for (let guard = 0; guard < 10_000; guard++) {
        let next: Timer | null = null;
        for (const t of timers.values()) if (t.due <= target && (!next || t.due < next.due || (t.due === next.due && t.id < next.id))) next = t;
        if (!next) break;
        now = Math.max(now, next.due);
        if (next.every === null) timers.delete(next.id);
        else next.due += next.every;
        try {
          next.fn();
        } catch (e) {
          console.error(e);
        }
        await flush();
      }
      now = target;
      const due = raf;
      raf = new Map();
      for (const cb of due.values()) {
        try {
          cb(now);
        } catch (e) {
          console.error(e);
        }
      }
      await flush();
      moveAnimations(dt);
      await flush();
    },
  };
}
