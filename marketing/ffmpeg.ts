/** ffmpeg helpers: run, two-pass loudness normalisation, loudness measurement. */

import { spawnSync } from 'node:child_process';
import { VIDEO } from './config';

export function ffmpeg(args: string[]) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${r.stderr}`);
  return r;
}

/** Two-pass EBU R128 normalisation to VIDEO.lufs, true peak VIDEO.truePeak. */
export function loudnorm(input: string, output: string) {
  const target = `I=${VIDEO.lufs}:TP=${VIDEO.truePeak}:LRA=11`;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', input, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`loudnorm analysis failed\n${r.stderr}`);
  const a = JSON.parse(m[0]) as Record<string, string>;
  const second = `loudnorm=${target}:measured_I=${a.input_i}:measured_TP=${a.input_tp}:measured_LRA=${a.input_lra}:measured_thresh=${a.input_thresh}:offset=${a.target_offset}:linear=true`;
  ffmpeg(['-i', input, '-af', `${second},aresample=48000`, '-c:a', 'pcm_s16le', output]);
  return a;
}

/** Integrated loudness and true peak of a file, as measured by ffmpeg's ebur128. */
export function measure(file: string) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const tail = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const I = Number(tail.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]);
  const TP = Number(tail.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]);
  return { I, TP };
}
