/**
 * Drives the real game in headless Chromium on the virtual clock: boots it
 * with a prepared save, steps it frame by frame, plays it with real touch
 * input (CDP touch events, the same path a phone finger takes), and records
 * frames and the finger's position for the edit.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { TOTAL_LEVELS } from '../../src/game/levels/levels';
import { SAVE_KEYS, SaveStore } from '../../src/game/save/SaveStore';
import type { SaveData } from '../../src/game/save/schema';
import { MemoryStore } from '../../src/platform/storage';
import type { ClientPoint, DropTarget } from '../../src/render/GameView';
import { CAPTURE } from '../config';
import { installVirtualClock } from './vclock';

export const ROOT = resolve(import.meta.dirname, '../..');
export const MARKETING = resolve(ROOT, 'marketing');

type Point = { x: number; y: number };
export type Target = { shelf: number; slot: number; slots: number } | { belt: true };

/** Every cargo type's first-encounter note and every guide step already seen: clips show play, not teaching. */
const ALL_CARGO = ['heavy', 'fragile', 'long', 'priority'];
const ALL_STEPS = ['place', 'preview', 'move'];

/** A real v2 save written by the game's own SaveStore (same envelope and checksum as the app). */
export function buildSave(edit: (d: SaveData) => void = () => undefined): string {
  const mem = new MemoryStore();
  const store = new SaveStore(mem, TOTAL_LEVELS);
  store.load();
  store.update((d) => {
    d.settings.sound = false;
    d.settings.haptics = false;
    d.settings.quality = CAPTURE.quality;
    d.settings.language = 'en';
    d.settings.reducedMotion = false;
    d.campaign.unlocked = TOTAL_LEVELS;
    d.tutorial.skipped = true;
    d.tutorial.done = [...ALL_STEPS];
    d.tutorial.seenCargo = [...ALL_CARGO];
    edit(d);
  });
  store.flush();
  const raw = mem.get(SAVE_KEYS.main);
  if (!raw) throw new Error('SaveStore wrote nothing');
  return raw;
}

/**
 * The bundled Roboto (SIL OFL) under the game's first font name. Android has
 * no Trebuchet MS, so a phone draws the game in its system sans (Roboto);
 * mapping the name here makes the capture look like that on any machine.
 */
export function gameFonts(family = 'Trebuchet MS') {
  const url = (file: string) => `data:font/woff2;base64,${readFileSync(join(MARKETING, 'fonts', file)).toString('base64')}`;
  return [
    { family, url: url('roboto-latin-standard-normal.woff2'), range: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
    { family, url: url('roboto-latin-ext-standard-normal.woff2'), range: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' },
  ];
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => res(port));
    });
  });
}

/** `vite preview` of the current dist/ on a free port. */
export async function servePreview(): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const child: ChildProcess = spawn(
    process.execPath,
    [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', detached: true },
  );
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    url,
    stop: () => {
      try {
        process.kill(-child.pid!);
      } catch {
        /* already gone */
      }
    },
  };
}

export interface FrameLog {
  /** Frame index within the clip. */
  i: number;
  /** Finger position in CSS px of the phone screen, or null when no finger is down. */
  finger: Point | null;
  /** A finger went down or up on this frame (for tap rings and click sounds). */
  event?: 'down' | 'up';
}

export class Director {
  page!: Page;
  private context!: BrowserContext;
  private cdp!: CDPSession;
  private finger: Point | null = null;
  private pendingEvent: 'down' | 'up' | undefined;
  private recording: { dir: string; log: FrameLog[]; n: number } | null = null;
  readonly dt = 1000 / CAPTURE.fps;

  private constructor() {}

  static async open(browser: Browser, baseUrl: string, save: string, query = '', viewport = CAPTURE.phone): Promise<Director> {
    const d = new Director();
    d.context = await browser.newContext({
      viewport,
      deviceScaleFactor: CAPTURE.dpr,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
      reducedMotion: 'no-preference',
    });
    await d.context.addInitScript(
      ([key, raw]) => {
        if (sessionStorage.getItem('seeded')) return;
        localStorage.clear();
        localStorage.setItem(key, raw);
        sessionStorage.setItem('seeded', '1');
      },
      [SAVE_KEYS.main, save] as const,
    );
    // As source text: tsx's name-keeping helper (__name) is not defined in the page.
    const args = JSON.stringify({ seed: CAPTURE.seed, fonts: gameFonts() });
    await d.context.addInitScript({ content: `var __name = (f) => f;\n(${installVirtualClock.toString()})(${args});` });
    d.page = await d.context.newPage();
    d.page.on('pageerror', (e) => console.error('[page error]', e.message));
    d.cdp = await d.context.newCDPSession(d.page);
    await d.page.goto(`${baseUrl}?e2e${query}`);
    await d.page.waitForFunction(() => !!(window as unknown as { __vclock?: unknown }).__vclock);
    await d.page.evaluate(() => document.fonts.load('800 20px "Trebuchet MS"'));
    return d;
  }

  async close() {
    await this.context.close();
  }

  // --- clock ----------------------------------------------------------------------

  /** One video frame: the clock moves 1/fps; recorded if a clip is rolling. */
  async step(n = 1) {
    for (let k = 0; k < n; k++) {
      if (process.env.STORE_DEBUG) {
        const [aim, held] = await Promise.all([this.aimed().catch(() => null), this.held().catch(() => null)]);
        console.log(`t=${(this.page ? await this.page.evaluate(() => (window as unknown as { __vclock: { now: number } }).__vclock.now) : 0).toFixed(0)} finger=${JSON.stringify(this.finger)} held=${held} aim=${JSON.stringify(aim)}`);
      }
      await this.page.evaluate((dt) => (window as unknown as { __vclock: { step(dt: number): Promise<void> } }).__vclock.step(dt), this.dt);
      if (this.recording) await this.grab();
    }
  }

  /** Steps until `pred` holds (checked every frame), or throws after `maxFrames`. */
  async until(pred: () => Promise<boolean>, maxFrames = 600, what = 'condition') {
    for (let k = 0; k < maxFrames; k++) {
      if (await pred()) return;
      await this.step();
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  async waitFor(selector: string, maxFrames = 600) {
    await this.until(async () => (await this.page.locator(selector).count()) > 0 && (await this.page.locator(selector).first().isVisible()), maxFrames, selector);
  }

  // --- recording --------------------------------------------------------------------

  startClip(name: string) {
    const dir = join(MARKETING, 'out', 'clips', name);
    mkdirSync(dir, { recursive: true });
    this.recording = { dir, log: [], n: 0 };
    this.pendingEvent = undefined; // a lift from before the clip (e.g. RESUME) is not part of it
  }

  endClip(meta: Record<string, unknown> = {}) {
    const r = this.recording;
    if (!r) throw new Error('endClip without startClip');
    writeFileSync(
      join(r.dir, 'clip.json'),
      JSON.stringify({ fps: CAPTURE.fps, frames: r.n, phone: CAPTURE.phone, dpr: CAPTURE.dpr, log: r.log, ...meta }, null, 1),
    );
    this.recording = null;
    return r.n;
  }

  private async grab() {
    const r = this.recording!;
    const file = join(r.dir, `${String(r.n).padStart(4, '0')}.jpg`);
    const shot = () => this.page.screenshot({ path: file, type: 'jpeg', quality: CAPTURE.jpegQuality, animations: 'allow', caret: 'initial', timeout: 120_000 });
    // Software WebGL can take a long frame when the machine is busy: one retry.
    await shot().catch(() => shot());
    const entry: FrameLog = { i: r.n, finger: this.finger ? { ...this.finger } : null };
    if (this.pendingEvent) entry.event = this.pendingEvent;
    this.pendingEvent = undefined;
    r.log.push(entry);
    r.n++;
  }

  /** A still of the current screen (menus, store shots). */
  async still(file: string) {
    mkdirSync(join(file, '..'), { recursive: true });
    await this.page.screenshot({ path: file, type: file.endsWith('.png') ? 'png' : 'jpeg', ...(file.endsWith('.png') ? {} : { quality: 95 }), animations: 'allow' });
  }

  // --- probes ----------------------------------------------------------------------------

  async pointOf(t: { cargo: number } | Target): Promise<ClientPoint> {
    const p = await this.page.evaluate(
      (target) => (window as unknown as { __cargoPanic: { clientPointOf(t: unknown): ClientPoint | null } }).__cargoPanic.clientPointOf(target),
      t,
    );
    if (!p) throw new Error(`no client point for ${JSON.stringify(t)}`);
    return p;
  }

  aimed(): Promise<DropTarget | null> {
    return this.page.evaluate(() => (window as unknown as { __cargoPanic: { aimed(): DropTarget | null } }).__cargoPanic.aimed());
  }

  snapshot(): Promise<{ phase: string; placements: { id: number; shelf: number; slot: number }[]; queue: number[]; hazards: Record<string, number> }> {
    return this.page.evaluate(() => (window as unknown as { __cargoPanic: { snapshot(): never } }).__cargoPanic.snapshot());
  }

  held(): Promise<number | null> {
    return this.page.evaluate(() => (window as unknown as { __cargoPanic: { board(): { held: number | null } } }).__cargoPanic.board().held);
  }

  async rectOf(selector: string) {
    const b = await this.page.locator(selector).first().boundingBox();
    if (!b) throw new Error(`no box for ${selector}`);
    return b;
  }

  // --- touch -------------------------------------------------------------------------------

  private async touch(type: 'touchStart' | 'touchMove' | 'touchEnd', p: Point | null) {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: p ? [{ x: p.x, y: p.y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] : [],
    });
  }

  async down(p: Point) {
    this.finger = { ...p };
    this.pendingEvent = 'down';
    await this.touch('touchStart', p);
  }

  async moveFinger(p: Point) {
    this.finger = { ...p };
    await this.touch('touchMove', p);
  }

  async up() {
    this.finger = null;
    this.pendingEvent = 'up';
    await this.touch('touchEnd', null);
  }

  /** A tap on a point: finger down one frame, up the next. */
  async tap(p: Point, holdFrames = 2) {
    await this.down(p);
    await this.step(holdFrames);
    await this.up();
    await this.step();
  }

  async tapSelector(selector: string, holdFrames = 2) {
    const b = await this.rectOf(selector);
    await this.tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, holdFrames);
  }

  /**
   * A real drag: the finger goes down on the package, travels to the target
   * over `frames` frames on an eased path (aiming the package, not the finger,
   * at the target), holds until the game shows that target, then lifts.
   */
  async drag(cargo: number, to: Target, frames = 18, settle = 4, opts: { flick?: number } = {}) {
    const want = JSON.stringify('belt' in to ? { kind: 'belt' } : { kind: 'slot', shelf: to.shelf, slot: to.slot });
    const start = await this.pointOf({ cargo });
    await this.down(start);
    await this.step(2);
    // A quick flick up off the belt, the way a thumb starts a drag: past the
    // drag slop and out of the belt's drop zone in one frame, so the belt
    // highlight does not flash on the way to the rack.
    await this.moveFinger({ x: start.x, y: start.y - (opts.flick ?? 100) });
    await this.step();
    const from = { ...this.finger! };
    const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
    for (let k = 1; k <= frames; k++) {
      const target = await this.pointOf(to);
      const drawn = await this.pointOf({ cargo });
      const off = { x: drawn.x - this.finger!.x, y: drawn.y - this.finger!.y };
      const aim = { x: target.x - off.x, y: target.y - off.y };
      const u = ease(k / frames);
      const lift = Math.sin(Math.PI * u) * 40;
      await this.moveFinger({ x: from.x + (aim.x - from.x) * u, y: from.y + (aim.y - from.y) * u - lift });
      await this.step();
    }
    for (let k = 0; k < 40; k++) {
      if (JSON.stringify(await this.aimed()) === want) break;
      const target = await this.pointOf(to);
      const drawn = await this.pointOf({ cargo });
      await this.moveFinger({ x: this.finger!.x + (target.x - drawn.x), y: this.finger!.y + (target.y - drawn.y) });
      await this.step();
    }
    if (JSON.stringify(await this.aimed()) !== want) throw new Error(`drag ${cargo}: target ${want} never shown`);
    await this.step(settle);
    await this.up();
    await this.step();
  }
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}
