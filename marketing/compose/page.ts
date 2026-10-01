/**
 * The edit, as a page: `renderAt(t)` puts the video frame for time t (s) on
 * screen and resolves once every image in it is decoded. Nothing moves on
 * its own - there are no CSS animations or transitions; every position,
 * opacity and letter offset is computed from t - so a screenshot after
 * renderAt(t) is exactly frame t, however long it took to draw.
 *
 * Bundled by render.ts (esbuild) and loaded in headless Chromium at 1920x1080.
 */

import { BRAND } from '../config';
import type { Timeline } from '../timeline';

type TL = Timeline;
type SceneT = TL['scenes'][number];

const W = 1920;
const H = 1080;

// --- easing -----------------------------------------------------------------------------
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOutExpo = (u: number) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));
const easeInExpo = (u: number) => (u <= 0 ? 0 : Math.pow(2, 10 * u - 10));
const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
/** A damped spring from 0 to 1 (overshoots once, settles). */
const spring = (u: number) => (u <= 0 ? 0 : 1 - Math.exp(-7 * u) * Math.cos(11 * u));

// --- DOM helpers --------------------------------------------------------------------------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.append(e);
  return e;
}

const pending: Promise<unknown>[] = [];
function setSrc(img: HTMLImageElement, src: string) {
  if (img.getAttribute('src') === src) return;
  img.src = src;
  pending.push(img.decode().catch(() => undefined));
}

const clipSrc = (clip: string, f: number) => `/out/clips/${clip}/${String(f).padStart(4, '0')}.jpg`;

// --- static layers ---------------------------------------------------------------------------
let tl: TL;
const stage = el('div', 'stage');
const scenesLayer = el('div', 'scenes', stage);
const flash = el('div', 'flash', stage);
const band = el('div', 'band', stage);
el('div', 'vignette', stage);
const grain = el('div', 'grain', stage);

/** One fixed noise tile (seeded): the grain does not change from frame to frame, so it costs almost nothing to encode. */
function makeGrain() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(256, 256);
  let s = 12345;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) >>> 0;
    const v = 128 + ((s >>> 16) % 90) - 45;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grain.style.backgroundImage = `url(${c.toDataURL()})`;
}

// --- title: letters rise out of a mask ----------------------------------------------------------
interface Title {
  root: HTMLElement;
  letters: HTMLElement[];
  bar: HTMLElement | null;
  sub: HTMLElement | null;
  subLetters: HTMLElement[];
}

function makeTitle(parent: HTMLElement, text: string, sub: string | undefined, opts: { size: number; width: number; align: 'left' | 'center'; bar?: string }): Title {
  const root = el('div', `title ${opts.align}`, parent);
  root.style.width = `${opts.width}px`;
  const lines = el('div', 'lines', root);
  const letters: HTMLElement[] = [];
  for (const word of text.split(' ')) {
    const mask = el('span', 'mask', lines);
    for (const ch of word) {
      const l = el('span', 'l', mask);
      l.textContent = ch;
      letters.push(l);
    }
    lines.append(document.createTextNode(' '));
  }
  // Capitals with marks (Ä, É, İ, Ş, Й, Ё...) need more room between the lines than the tight .92.
  const lineHeight = /\p{M}/u.test(text.toLocaleUpperCase().normalize('NFD')) ? 1.08 : 0.92;
  lines.style.lineHeight = String(lineHeight);
  // Largest size up to opts.size that keeps every word on the line and at most 3 lines.
  let size = opts.size;
  for (; size > 40; size -= 4) {
    lines.style.fontSize = `${size}px`;
    const tooWide = [...lines.querySelectorAll<HTMLElement>('.mask')].some((m) => m.offsetWidth > opts.width);
    const rows = Math.round(lines.offsetHeight / (size * lineHeight));
    if (!tooWide && rows <= 3) break;
  }
  lines.style.fontSize = `${size}px`;
  let bar: HTMLElement | null = null;
  if (opts.bar) {
    bar = el('div', 'bar', root);
    bar.style.background = opts.bar;
  }
  let subEl: HTMLElement | null = null;
  const subLetters: HTMLElement[] = [];
  if (sub) {
    subEl = el('div', 'sub', root);
    const mask = el('span', 'mask', subEl);
    const l = el('span', 'l', mask);
    l.textContent = sub;
    subLetters.push(l);
  }
  return { root, letters, bar, sub: subEl, subLetters };
}

function drawTitle(ti: Title, t: number, t0: number) {
  ti.letters.forEach((l, i) => {
    const u = clamp((t - (t0 + 0.04 + i * 0.028)) / 0.5);
    l.style.transform = `translateY(${(1 - easeOutExpo(u)) * 105}%)`;
  });
  if (ti.bar) ti.bar.style.transform = `scaleX(${easeOutExpo(clamp((t - t0 - 0.15) / 0.6))})`;
  ti.subLetters.forEach((l) => {
    const u = clamp((t - (t0 + 0.35)) / 0.6);
    l.style.transform = `translateY(${(1 - easeOutExpo(u)) * 110}%)`;
  });
}

// --- phone mock (no brand, no logo) -----------------------------------------------------------------
interface Phone {
  root: HTMLElement;
  screen: HTMLElement;
  imgs: HTMLImageElement[];
  dot: HTMLElement;
  ring: HTMLElement;
}

function makePhone(parent: HTMLElement, height: number, screens = 1): Phone {
  const root = el('div', 'phone', parent);
  const sw = (height - 36) * (412 / 915);
  root.style.width = `${sw + 36}px`;
  root.style.height = `${height}px`;
  const screen = el('div', 'screen', root);
  const imgs = Array.from({ length: screens }, () => el('img', 'shot', screen));
  el('div', 'camera', root);
  const ring = el('div', 'ring', screen);
  const dot = el('div', 'dot', screen);
  return { root, screen, imgs, dot, ring };
}

/** Finger dot and touch ring on a phone screen or card, in that surface's px. */
function drawTouch(dot: HTMLElement, ring: HTMLElement, finger: { x: number; y: number } | null, ringAt: { x: number; y: number; age: number } | null, scale: number) {
  if (finger) {
    dot.style.opacity = '1';
    dot.style.transform = `translate(${finger.x * scale - 26}px, ${finger.y * scale - 26}px)`;
  } else dot.style.opacity = '0';
  if (ringAt && ringAt.age >= 0 && ringAt.age < 0.5) {
    const u = ringAt.age / 0.5;
    const r = 20 + 70 * easeOutExpo(u);
    ring.style.opacity = String(0.9 * (1 - u));
    ring.style.width = ring.style.height = `${r * 2}px`;
    ring.style.transform = `translate(${ringAt.x * scale - r}px, ${ringAt.y * scale - r}px)`;
  } else ring.style.opacity = '0';
}

// --- scenes ---------------------------------------------------------------------------------------------
interface Built {
  s: SceneT;
  root: HTMLElement;
  draw: (t: number) => void;
}

function frameAt(p: { t0: number; fps: number; frames: number }, t: number) {
  return clamp(Math.floor((t - p.t0) * p.fps + 1e-6), 0, p.frames - 1);
}

function background(root: HTMLElement, tint: string) {
  const bg = el('div', 'bg', root);
  bg.style.background = `radial-gradient(60% 75% at 50% 55%, ${tint}33 0%, transparent 70%), radial-gradient(120% 90% at 50% 40%, #182233 0%, ${BRAND.bg} 70%)`;
  el('div', 'stripes', root);
  return bg;
}

function buildCard(s: SceneT): Built {
  const L = s.layout as Extract<SceneT['layout'], { kind: 'card' }>;
  const root = el('div', 'scene', scenesLayer);
  const tint = L.tint ?? BRAND.accent;
  background(root, tint);
  const cardH = 960;
  const scale = cardH / L.crop.h;
  const cardW = L.crop.w * scale;
  const card = el('div', 'card', root);
  card.style.width = `${cardW}px`;
  card.style.height = `${cardH}px`;
  card.style.boxShadow = `0 40px 90px rgba(0,0,0,.6), 0 0 0 3px ${BRAND.panelEdge}, 0 0 120px ${tint}40`;
  const cx = L.side === 'right' ? W * 0.7 : W * 0.3;
  card.style.left = `${cx - cardW / 2}px`;
  card.style.top = `${(H - cardH) / 2}px`;
  const inner = el('div', 'inner', card);
  const img = el('img', 'frame', inner);
  img.style.width = `${412 * scale}px`;
  img.style.left = `${-L.crop.x * scale}px`;
  img.style.top = `${-L.crop.y * scale}px`;
  const ring = el('div', 'ring', inner);
  const dot = el('div', 'dot', inner);
  dot.style.left = `${-L.crop.x * scale}px`;
  dot.style.top = `${-L.crop.y * scale}px`;
  ring.style.left = dot.style.left;
  ring.style.top = dot.style.top;
  const textBox = el('div', 'textbox', root);
  textBox.style.left = L.side === 'right' ? '130px' : `${W * 0.56}px`;
  const title = makeTitle(textBox, s.title ?? '', s.sub, { size: 150, width: 720, align: 'left', bar: tint });
  const p = s.placed[0];
  const fingers = tl.fingers[p.clip];
  const rings = tl.rings.filter((r) => r.scene === s.id);
  return {
    s,
    root,
    draw: (t) => {
      const f = frameAt(p, t);
      setSrc(img, clipSrc(p.clip, f));
      const u = clamp((t - s.t) / (s.end - s.t));
      // Slow push-in, and a spring pop as the card arrives.
      const pop = 0.94 + 0.06 * spring(clamp((t - s.t) / 0.45));
      inner.style.transform = `scale(${1 + 0.05 * u})`;
      card.style.transform = `scale(${pop}) rotate(${(L.side === 'right' ? 1 : -1) * (1 - u) * 0.6}deg)`;
      const last = [...rings].reverse().find((r) => r.t <= t);
      drawTouch(dot, ring, fingers[f] ?? null, last ? { x: last.x, y: last.y, age: t - last.t } : null, scale);
      drawTitle(title, t, s.t);
    },
  };
}

function buildPhoneScene(s: SceneT): Built {
  const L = s.layout as Extract<SceneT['layout'], { kind: 'phone' }>;
  const root = el('div', 'scene', scenesLayer);
  background(root, BRAND.accent);
  const holder = el('div', 'phone-holder', root);
  holder.style.left = `${W * 0.68}px`;
  const phone = makePhone(holder, 980, L.screens.length);
  L.screens.forEach((sc, i) => setSrc(phone.imgs[i], `/out/menus/${sc.still}.png`));
  const textBox = el('div', 'textbox', root);
  textBox.style.left = '130px';
  const title = makeTitle(textBox, s.title ?? '', s.sub, { size: 150, width: 760, align: 'left', bar: BRAND.accent });
  const scale = (980 - 36) / 915;
  const taps = L.screens.filter((sc) => sc.tap).map((sc) => ({ t: sc.tap!.beat * (60 / tl.bpm), r: tl.menus!.taps[sc.tap!.target] }));
  return {
    s,
    root,
    draw: (t) => {
      const u = clamp((t - s.t) / (s.end - s.t));
      const inU = easeOutExpo(clamp((t - s.t) / 0.7));
      const ry = -26 + 12 * u;
      phone.root.style.transform = `translate(-50%, -50%) translateY(${(1 - inU) * 300}px) perspective(2600px) rotateY(${ry}deg) rotateX(${7 - 3 * u}deg) rotateZ(${-2 + u * 1.5}deg)`;
      L.screens.forEach((sc, i) => {
        const from = sc.from * (60 / tl.bpm);
        const next = L.screens[i + 1] ? L.screens[i + 1].from * (60 / tl.bpm) : Infinity;
        const a = i === 0 ? 1 : clamp((t - from) / 0.2);
        phone.imgs[i].style.opacity = String(t < next ? a : 0);
        phone.imgs[i].style.zIndex = String(i + 1);
      });
      // The finger comes down just before each tap and lifts after it.
      let finger: { x: number; y: number } | null = null;
      let ringAt: { x: number; y: number; age: number } | null = null;
      for (const tp of taps) {
        const c = { x: tp.r.x + tp.r.width / 2, y: tp.r.y + tp.r.height / 2 };
        if (t > tp.t - 0.3 && t < tp.t + 0.12) finger = c;
        if (t >= tp.t) ringAt = { ...c, age: t - tp.t };
      }
      drawTouch(phone.dot, phone.ring, finger, ringAt, scale);
      drawTitle(title, t, s.t);
    },
  };
}

function buildPair(s: SceneT): Built {
  const L = s.layout as Extract<SceneT['layout'], { kind: 'pair' }>;
  const root = el('div', 'scene', scenesLayer);
  background(root, BRAND.warm);
  const textBox = el('div', 'textbox', root);
  textBox.style.left = '130px';
  const title = makeTitle(textBox, s.title ?? '', s.sub, { size: 150, width: 640, align: 'left', bar: BRAND.accent });
  const phoneH = 880;
  const phones = [0, 1].map((i) => {
    const holder = el('div', 'phone-holder', root);
    holder.style.left = `${W * (i === 0 ? 0.57 : 0.81)}px`;
    holder.style.top = `${H * 0.555}px`;
    const ph = makePhone(holder, phoneH);
    const chip = el('div', 'chip', holder);
    chip.textContent = L.labels[i];
    chip.style.top = `${-phoneH / 2 - 92}px`;
    return { ph, chip, p: s.placed[i] };
  });
  const scale = (phoneH - 36) / 915;
  return {
    s,
    root,
    draw: (t) => {
      phones.forEach(({ ph, chip, p }, i) => {
        const f = frameAt(p, t);
        setSrc(ph.imgs[0], clipSrc(p.clip, f));
        const inU = easeOutExpo(clamp((t - s.t - i * 0.08) / 0.6));
        const tilt = i === 0 ? 10 : -10;
        ph.root.style.transform = `translate(-50%, -50%) translateY(${(1 - inU) * 500}px) perspective(2400px) rotateY(${tilt}deg)`;
        chip.style.transform = `translate(-50%, 0) scale(${spring(clamp((t - s.t - 0.3 - i * 0.1) / 0.5))})`;
        const fg = tl.fingers[p.clip][f] ?? null;
        drawTouch(ph.dot, ph.ring, fg, null, scale);
      });
      drawTitle(title, t, s.t);
    },
  };
}

/** The game's favicon mark (index.html), drawn large: a crate on a shelf bar. */
function logoMark(parent: HTMLElement, size: number) {
  const box = el('div', 'mark', parent);
  box.style.width = box.style.height = `${size}px`;
  box.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}"><rect width="32" height="32" rx="7" fill="${BRAND.bg}"/><rect x="6" y="13" width="20" height="11" rx="2" fill="${BRAND.warm}"/><rect x="14" y="13" width="4" height="11" fill="${BRAND.tape}"/><rect x="5" y="8" width="22" height="3" rx="1.5" fill="${BRAND.accent}"/></svg>`;
  return box;
}

function wordmark(parent: HTMLElement, size: number) {
  const wm = el('div', 'wordmark', parent);
  wm.style.fontSize = `${size}px`;
  const lines = BRAND.wordmark.map((w, i) => {
    const line = el('div', `wm-line ${i ? 'warm' : ''}`, wm);
    const mask = el('span', 'mask', line);
    return [...w].map((ch) => {
      const l = el('span', 'l', mask);
      l.textContent = ch;
      return l;
    });
  });
  return (t: number, t0: number) =>
    lines.flat().forEach((l, i) => {
      const u = clamp((t - (t0 + 0.05 + i * 0.045)) / 0.6);
      l.style.transform = `translateY(${(1 - easeOutExpo(u)) * 105}%)`;
    });
}

function buildLogo(s: SceneT): Built {
  const root = el('div', 'scene', scenesLayer);
  background(root, BRAND.warm);
  const center = el('div', 'center', root);
  const mark = logoMark(center, 170);
  const drawWm = wordmark(center, 190);
  return {
    s,
    root,
    draw: (t) => {
      mark.style.transform = `scale(${spring(clamp((t - s.t - 0.05) / 0.7))}) rotate(${(1 - easeOutExpo(clamp((t - s.t) / 0.8))) * -25}deg)`;
      drawWm(t, s.t + 0.15);
      center.style.transform = `scale(${1 + 0.04 * clamp((t - s.t) / (s.end - s.t))})`;
    },
  };
}

function buildEnd(s: SceneT): Built {
  const root = el('div', 'scene', scenesLayer);
  background(root, BRAND.accent);
  const phones = ['title-3d', 'title-2d'].map((still, i) => {
    const holder = el('div', 'phone-holder', root);
    holder.style.left = `${W * (i === 0 ? 0.15 : 0.85)}px`;
    holder.style.top = `${H * 0.56}px`;
    const ph = makePhone(holder, 860);
    setSrc(ph.imgs[0], `/out/menus/${still}.png`);
    return ph;
  });
  const center = el('div', 'center end', root);
  const mark = logoMark(center, 120);
  const drawWm = wordmark(center, 150);
  const tag = el('div', 'tagline', center);
  const tagMask = el('span', 'mask', tag);
  const tagL = el('span', 'l', tagMask);
  tagL.textContent = BRAND.tagline;
  const badge = el('div', 'badge', center);
  badge.textContent = 'FREE ON ANDROID';
  return {
    s,
    root,
    draw: (t) => {
      const k = t - s.t;
      mark.style.transform = `scale(${spring(clamp(k / 0.7))})`;
      drawWm(t, s.t + 0.1);
      tagL.style.transform = `translateY(${(1 - easeOutExpo(clamp((k - 0.6) / 0.6))) * 110}%)`;
      badge.style.transform = `scale(${spring(clamp((k - 1.0) / 0.6))})`;
      phones.forEach((ph, i) => {
        const inU = easeOutExpo(clamp((k - 0.2 - i * 0.1) / 0.9));
        const side = i === 0 ? -1 : 1;
        ph.root.style.transform = `translate(-50%, -50%) translateX(${side * (1 - inU) * 500}px) perspective(2400px) rotateY(${-side * 20}deg) rotateZ(${side * 4}deg)`;
      });
    },
  };
}

// --- transitions ------------------------------------------------------------------------------
function whipOffset(s: SceneT, next: SceneT | undefined, t: number) {
  // Outgoing: accelerates off to the left in the last 0.15 s before a whip.
  let x = 0;
  let blur = 0;
  if (next?.enter === 'whip' && t > next.t - 0.15) {
    const u = easeInExpo(clamp((t - (next.t - 0.15)) / 0.15));
    x = -u * W * 0.7;
    blur = u * 70;
  }
  if (s.enter === 'whip' && t < s.t + 0.22) {
    const u = 1 - easeOutExpo(clamp((t - s.t) / 0.22));
    x = u * W * 0.7;
    blur = u * 70;
  }
  return { x, blur };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
let blurNodes: SVGFEGaussianBlurElement[] = [];
function blurFilters() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  const defs = document.createElementNS(SVG_NS, 'defs');
  svg.append(defs);
  blurNodes = [0, 1].map((i) => {
    const f = document.createElementNS(SVG_NS, 'filter');
    f.id = `hblur${i}`;
    f.setAttribute('x', '-20%');
    f.setAttribute('width', '140%');
    const g = document.createElementNS(SVG_NS, 'feGaussianBlur') as SVGFEGaussianBlurElement;
    g.setAttribute('stdDeviation', '0 0');
    f.append(g);
    defs.append(f);
    return g;
  });
  document.body.append(svg);
}

// --- main ------------------------------------------------------------------------------------------
let built: Built[] = [];

async function setup(timeline: TL) {
  tl = timeline;
  document.body.append(stage);
  blurFilters();
  makeGrain();
  await document.fonts.ready;
  built = tl.scenes.map((s) => {
    switch (s.layout.kind) {
      case 'card':
        return buildCard(s);
      case 'phone':
        return buildPhoneScene(s);
      case 'pair':
        return buildPair(s);
      case 'logo':
        return buildLogo(s);
      case 'end':
        return buildEnd(s);
    }
  });
  await Promise.all(pending.splice(0));
}

async function renderAt(t: number) {
  let slot = 0;
  built.forEach((b, i) => {
    const next = built[i + 1]?.s;
    // A scene is on screen from its start to its end, plus the next scene's whip-out lead-in.
    const wipeIn = b.s.enter === 'wipe' ? 0.28 : 0;
    const on = t >= b.s.t - wipeIn && t < b.s.end;
    b.root.style.display = on ? 'block' : 'none';
    if (!on) return;
    b.draw(t);
    const { x, blur } = whipOffset(b.s, next, t);
    if (blur > 0.5 && slot < 2) {
      blurNodes[slot].setAttribute('stdDeviation', `${blur} 0`);
      b.root.style.filter = `url(#hblur${slot})`;
      slot++;
    } else b.root.style.filter = 'none';
    b.root.style.transform = `translateX(${x}px)`;
    // Wipe: the new scene is revealed behind the band's trailing edge.
    if (b.s.enter === 'wipe' && t < b.s.t + 0.28) {
      const u = easeInOutCubic(clamp((t - (b.s.t - 0.28)) / 0.56));
      const edge = -400 + (W + 800) * u;
      b.root.style.clipPath = `polygon(0 0, ${edge + 120}px 0, ${edge - 120}px 100%, 0 100%)`;
      b.root.style.zIndex = '2';
    } else {
      b.root.style.clipPath = 'none';
      b.root.style.zIndex = '1';
    }
  });

  // The hazard-stripe band that leads every wipe.
  const wipe = tl.scenes.find((s) => s.enter === 'wipe' && t >= s.t - 0.28 && t < s.t + 0.28);
  if (wipe) {
    const u = easeInOutCubic(clamp((t - (wipe.t - 0.28)) / 0.56));
    const edge = -400 + (W + 800) * u;
    band.style.display = 'block';
    band.style.transform = `translateX(${edge - 190}px) skewX(-12deg)`;
  } else band.style.display = 'none';

  // A white flash on flash cuts.
  const fl = tl.scenes.find((s) => s.enter === 'flash' && t >= s.t && t < s.t + 0.25);
  flash.style.opacity = fl ? String(0.85 * (1 - easeOutExpo(clamp((t - fl.t) / 0.25)))) : '0';
  // And one on the impact when the rack falls.
  const hit = tl.cues.find((c) => c.kind === 'impact' && t >= c.t && t < c.t + 0.2);
  if (hit) flash.style.opacity = String(Math.max(Number(flash.style.opacity), 0.7 * (1 - clamp((t - hit.t) / 0.2))));

  await Promise.all(pending.splice(0));
}

// --- store stills ------------------------------------------------------------------------------------------

/** Only the named still is on stage: the video layers are hidden. */
function stillStage(w: number, h: number) {
  document.body.append(stage);
  document.documentElement.style.width = document.body.style.width = `${w}px`;
  document.documentElement.style.height = document.body.style.height = `${h}px`;
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  scenesLayer.replaceChildren();
  flash.style.opacity = '0';
  band.style.display = 'none';
  if (!grain.style.backgroundImage) makeGrain();
  const root = el('div', 'scene', scenesLayer);
  root.style.display = 'block';
  return root;
}

interface ShotSpec {
  title: string;
  sub?: string;
  /** One gameplay frame (with its crop) or two phone screens. */
  images: string[];
  crop?: { x: number; y: number; w: number; h: number };
  tint: string;
  side: 'left' | 'right';
}

/** A 1920 x 1080 store screenshot: the game on a card (or two phones) and a headline. */
async function renderShot(spec: ShotSpec) {
  await document.fonts.ready;
  const root = stillStage(W, H);
  background(root, spec.tint);
  if (spec.images.length === 2) {
    const textBox = el('div', 'textbox', root);
    textBox.style.left = '120px';
    const title = makeTitle(textBox, spec.title, spec.sub, { size: 128, width: 700, align: 'left', bar: spec.tint });
    drawTitle(title, 99, 0);
    [0, 1].forEach((i) => {
      const holder = el('div', 'phone-holder', root);
      holder.style.left = `${W * (i === 0 ? 0.6 : 0.83)}px`;
      holder.style.top = `${H * 0.53}px`;
      const ph = makePhone(holder, 900);
      setSrc(ph.imgs[0], spec.images[i]);
      ph.root.style.transform = `translate(-50%, -50%) perspective(2400px) rotateY(${i === 0 ? 12 : -12}deg)`;
      const chip = el('div', 'chip', holder);
      chip.textContent = i === 0 ? '3D' : '2D';
      chip.style.top = '-560px';
      chip.style.transform = 'translate(-50%, 0)';
    });
  } else {
    const crop = spec.crop!;
    const cardH = 960;
    const scale = cardH / crop.h;
    const cardW = crop.w * scale;
    const card = el('div', 'card', root);
    card.style.width = `${cardW}px`;
    card.style.height = `${cardH}px`;
    card.style.boxShadow = `0 40px 90px rgba(0,0,0,.6), 0 0 0 3px ${BRAND.panelEdge}, 0 0 120px ${spec.tint}40`;
    const cx = spec.side === 'right' ? W * 0.71 : W * 0.29;
    card.style.left = `${cx - cardW / 2}px`;
    card.style.top = `${(H - cardH) / 2}px`;
    const inner = el('div', 'inner', card);
    const img = el('img', 'frame', inner);
    img.style.width = `${412 * scale}px`;
    img.style.left = `${-crop.x * scale}px`;
    img.style.top = `${-crop.y * scale}px`;
    setSrc(img, spec.images[0]);
    const textBox = el('div', 'textbox', root);
    textBox.style.left = spec.side === 'right' ? '120px' : `${W * 0.55}px`;
    const title = makeTitle(textBox, spec.title, spec.sub, { size: 140, width: 760, align: 'left', bar: spec.tint });
    drawTitle(title, 99, 0);
  }
  await Promise.all(pending.splice(0));
}

/** The 1024 x 500 feature graphic: an in-engine shot and the wordmark, nothing else. */
async function renderFeature(src: string) {
  await document.fonts.ready;
  const root = stillStage(1024, 500);
  const img = el('img', '', root);
  // Closer on the rack and to the right of centre, leaving the left for the wordmark.
  img.style.cssText = 'position:absolute;width:140%;left:-2%;top:-20%';
  setSrc(img, src);
  const shade = el('div', '', root);
  shade.style.cssText = `position:absolute;inset:0;background:linear-gradient(90deg, ${BRAND.bg}f2 0%, ${BRAND.bg}cc 30%, transparent 58%)`;
  const box = el('div', '', root);
  box.style.cssText = 'position:absolute;left:64px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:flex-start';
  const mark = logoMark(box, 84);
  mark.style.marginBottom = '18px';
  const drawWm = wordmark(box, 104);
  (box.querySelector('.wordmark') as HTMLElement).style.textAlign = 'left';
  drawWm(99, 0);
  await Promise.all(pending.splice(0));
}

/** The 512 x 512 app icon: the game's own mark (index.html favicon), full bleed - the store rounds it. */
async function renderIcon() {
  const root = stillStage(512, 512);
  root.innerHTML = `<svg viewBox="0 0 32 32" width="512" height="512">
    <defs>
      <radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#1a2433"/><stop offset="1" stop-color="${BRAND.bg}"/></radialGradient>
      <linearGradient id="crate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6b75a"/><stop offset="1" stop-color="${BRAND.warm}"/></linearGradient>
    </defs>
    <rect width="32" height="32" fill="url(#g)"/>
    <ellipse cx="16" cy="24.4" rx="10.5" ry="0.9" fill="#000" opacity=".45"/>
    <rect x="6" y="13" width="20" height="11" rx="2" fill="url(#crate)"/>
    <rect x="14" y="13" width="4" height="11" fill="${BRAND.tape}"/>
    <rect x="5" y="8" width="22" height="3" rx="1.5" fill="${BRAND.accent}"/>
  </svg>`;
  grain.style.display = 'none';
  (document.querySelector('.vignette') as HTMLElement).style.display = 'none';
}

Object.assign(window, { setup, renderAt, renderShot, renderFeature, renderIcon });
