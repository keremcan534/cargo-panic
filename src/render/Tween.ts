/**
 * A very small tween runner. Drives numeric properties on plain objects (Vector3
 * fields, material opacity, rotation.z...) from the render loop, so the game
 * never depends on requestAnimationFrame timing directly.
 */

export type Ease = (t: number) => number;

export const Easing = {
  linear: (t: number) => t,
  quadOut: (t: number) => 1 - (1 - t) * (1 - t),
  quadIn: (t: number) => t * t,
  quadInOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  cubicOut: (t: number) => 1 - Math.pow(1 - t, 3),
  backOut: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  backIn: (t: number) => {
    const c1 = 1.70158;
    return (c1 + 1) * t * t * t - c1 * t * t;
  },
  bounceOut: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  sineInOut: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
} as const;

type Numeric<T> = { [K in keyof T]?: number };

interface Active {
  target: Record<string, number>;
  from: Record<string, number>;
  to: Record<string, number>;
  ms: number;
  delay: number;
  elapsed: number;
  ease: Ease;
  yoyo: boolean;
  repeat: number;
  onUpdate?: () => void;
  onDone?: () => void;
  done: boolean;
}

export interface TweenOpts {
  ms: number;
  ease?: Ease;
  delay?: number;
  yoyo?: boolean;
  /** -1 = forever. */
  repeat?: number;
  onUpdate?: () => void;
  onDone?: () => void;
}

export class Tweens {
  private active: Active[] = [];

  add<T extends object>(target: T, to: Numeric<T>, opts: TweenOpts): () => void {
    const t = target as unknown as Record<string, number>;
    const from: Record<string, number> = {};
    const dest: Record<string, number> = {};
    for (const k of Object.keys(to)) {
      from[k] = t[k];
      dest[k] = (to as Record<string, number>)[k];
    }
    const a: Active = {
      target: t,
      from,
      to: dest,
      ms: Math.max(1, opts.ms),
      delay: opts.delay ?? 0,
      elapsed: 0,
      ease: opts.ease ?? Easing.quadOut,
      yoyo: opts.yoyo ?? false,
      repeat: opts.repeat ?? 0,
      onUpdate: opts.onUpdate,
      onDone: opts.onDone,
      done: false,
    };
    this.active.push(a);
    return () => {
      a.done = true;
    };
  }

  /** Cancels every tween touching this object. */
  kill(target: object) {
    for (const a of this.active) if (a.target === target) a.done = true;
  }

  /** Simple timer expressed as a tween so it lives on the same clock. */
  delay(ms: number, fn: () => void): () => void {
    return this.add({ v: 0 }, { v: 1 }, { ms, ease: Easing.linear, onDone: fn });
  }

  update(dtMs: number) {
    for (const a of this.active) {
      if (a.done) continue;
      if (a.delay > 0) {
        a.delay -= dtMs;
        if (a.delay > 0) continue;
        a.elapsed = -a.delay;
        a.delay = 0;
      } else {
        a.elapsed += dtMs;
      }
      let p = Math.min(1, a.elapsed / a.ms);
      const finished = p >= 1;
      const cycleP = a.yoyo ? (p < 0.5 ? p * 2 : 2 - p * 2) : p;
      const e = a.ease(Math.min(1, Math.max(0, cycleP)));
      for (const k of Object.keys(a.to)) a.target[k] = a.from[k] + (a.to[k] - a.from[k]) * e;
      a.onUpdate?.();
      if (finished) {
        if (a.repeat !== 0) {
          if (a.repeat > 0) a.repeat--;
          a.elapsed = 0;
          p = 0;
        } else {
          a.done = true;
          a.onDone?.();
        }
      }
    }
    if (this.active.length > 64 || this.active.some((a) => a.done)) {
      this.active = this.active.filter((a) => !a.done);
    }
  }

  clear() {
    this.active = [];
  }
}
