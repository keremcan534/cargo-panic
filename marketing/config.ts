/**
 * Settings for the store assets (video, screenshots, feature graphic, icon).
 * `npm run store:assets` reads everything from here and from storyboard.ts.
 */

export const CAPTURE = {
  /** Phone screen in CSS px (a 20:9 phone) and its pixel ratio. */
  phone: { width: 412, height: 915 },
  dpr: 2,
  fps: 30,
  /** 3D graphics at the top profile (bloom, shadows, full particle budget). */
  quality: 'high' as const,
  /** Seeds Math.random in the page, so a re-run records the same frames. */
  seed: 20260930,
  jpegQuality: 92,
};

export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
  bpm: 120,
  /** x264 settings for the master file. */
  crf: 18,
  preset: 'slow',
  /** Loudness target (EBU R128 integrated) and true-peak ceiling. */
  lufs: -14,
  truePeak: -1,
  /** Above this size a two-pass share copy is made too. */
  shareLimitMB: 30,
  shareVideoKbps: 5500,
};

/** The game's own palette and wordmark (src/style.css, src/ui/Menu.ts, index.html). */
export const BRAND = {
  bg: '#0d1117',
  panel: '#151d29',
  panelEdge: '#2e3a4b',
  text: '#eef4ff',
  dim: '#8fa2ba',
  accent: '#4da3ff',
  warm: '#f0a53c',
  gold: '#ffc93c',
  good: '#3fd68a',
  bad: '#ff5f57',
  tape: '#c47a1e',
  wordmark: ['CARGO', 'PANIC'] as const,
  tagline: 'Pack the warehouse without tipping the shelves',
  studio: 'BLACKBLUE STUDIOS',
};

export const STORE = {
  locale: 'en-US',
  screenshot: { width: 1920, height: 1080 },
  feature: { width: 1024, height: 500 },
  icon: 512,
};
