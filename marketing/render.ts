/**
 * Renders the trailer from the recorded clips:
 *   1. resolve the storyboard into a timeline (timeline.ts),
 *   2. synthesise the sound and bring it to the loudness target (audio.ts, ffmpeg loudnorm, two passes),
 *   3. draw every frame with the compose page and pipe it to ffmpeg (H.264, yuv420p, CRF, +faststart),
 *   4. make a contact sheet (2 frames a second) for review, and a two-pass share copy if the file is large.
 *
 *   npx tsx marketing/render.ts            # the whole video
 *   npx tsx marketing/render.ts --from 12 --to 16   # a preview of part of it
 */

import { spawn } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { synthesize } from './audio';
import { MARKETING } from './capture/director';
import { serveCompose } from './compose/serve';
import { VIDEO } from './config';
import { ffmpeg, loudnorm, measure } from './ffmpeg';
import { buildTimeline, type Timeline } from './timeline';

const OUT = join(MARKETING, 'out');

/** Frames where a clip is asked for outside what was recorded (it would freeze). */
function frozen(tl: Timeline) {
  const out: string[] = [];
  for (const s of tl.scenes)
    for (const p of s.placed) {
      const a = Math.floor((s.t - p.t0) * p.fps);
      const b = Math.floor((s.end - p.t0) * p.fps) - 1;
      if (a < 0 || b >= p.frames) out.push(`${s.id}: ${p.clip} needs frames ${a}..${b}, has 0..${p.frames - 1}`);
    }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k: string) => (argv.includes(k) ? Number(argv[argv.indexOf(k) + 1]) : undefined);
  mkdirSync(OUT, { recursive: true });
  const tl = buildTimeline();
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify(tl, null, 1));
  const warn = frozen(tl);
  for (const w of warn) console.warn(`[frozen] ${w}`);

  const from = arg('--from') ?? 0;
  const to = arg('--to') ?? tl.duration;
  const preview = from > 0 || to < tl.duration;
  const video = join(OUT, preview ? `preview-${from}-${to}.mp4` : 'cargo-panic-trailer.mp4');

  // Sound.
  const raw = join(OUT, 'audio-raw.wav');
  const audio = join(OUT, 'audio.wav');
  synthesize(tl, raw);
  loudnorm(raw, audio);

  // Picture.
  const server = await serveCompose();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: VIDEO.width, height: VIDEO.height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()));
  await page.goto(server.url);
  await page.waitForFunction(() => typeof (window as unknown as { setup?: unknown }).setup === 'function');
  await page.evaluate((t) => (window as unknown as { setup(t: unknown): Promise<void> }).setup(t), tl);

  const enc = spawn(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-framerate', String(VIDEO.fps), '-c:v', 'png', '-i', '-',
      '-ss', String(from), '-t', String(to - from), '-i', audio,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-preset', VIDEO.preset, '-crf', String(VIDEO.crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart', '-shortest', video,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const done = new Promise<number>((r) => enc.on('close', (c) => r(c ?? 1)));
  const n0 = Math.round(from * VIDEO.fps);
  const n1 = Math.round(to * VIDEO.fps);
  const t0 = Date.now();
  for (let n = n0; n < n1; n++) {
    await page.evaluate((t) => (window as unknown as { renderAt(t: number): Promise<void> }).renderAt(t), n / VIDEO.fps);
    const png = await page.screenshot({ type: 'png' });
    if (!enc.stdin.write(png)) await new Promise((r) => enc.stdin.once('drain', r));
    if ((n - n0) % 60 === 0) console.log(`frame ${n - n0}/${n1 - n0} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  enc.stdin.end();
  const code = await done;
  await browser.close();
  await server.close();
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);

  // Review material.
  const sheet = join(OUT, preview ? `contact-${from}-${to}.jpg` : 'contact-sheet.jpg');
  const cols = 6;
  const rows = Math.ceil(((to - from) * 2) / cols);
  ffmpeg(['-i', video, '-vf', `fps=2,scale=384:-1,drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6,tile=${cols}x${rows}:padding=4`, '-frames:v', '1', sheet]);

  const mb = statSync(video).size / 1e6;
  const loud = measure(video);
  console.log(`${video}: ${mb.toFixed(1)} MB, ${(to - from).toFixed(1)} s, loudness ${loud.I} LUFS, true peak ${loud.TP} dBFS`);
  console.log(`contact sheet: ${sheet}`);
  if (!preview && mb > VIDEO.shareLimitMB) {
    const share = join(OUT, 'cargo-panic-trailer-share.mp4');
    const common = ['-i', video, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${VIDEO.shareVideoKbps}k`, '-pix_fmt', 'yuv420p', '-passlogfile', join(OUT, 'x264pass')];
    ffmpeg([...common, '-pass', '1', '-an', '-f', 'null', '/dev/null']);
    ffmpeg([...common, '-pass', '2', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', share]);
    console.log(`share copy: ${share} ${(statSync(share).size / 1e6).toFixed(1)} MB`);
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
