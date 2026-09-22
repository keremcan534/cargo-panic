/**
 * Target and status icons shared by both renderers: vector paths drawn
 * straight onto a canvas (no glyph fonts, so they look the same on every
 * device). The 2D view draws them on its frame; the 3D view bakes them into
 * decal textures. Each drop-target kind has its own shape - colour is never
 * the only cue.
 *
 * No three.js here.
 */

export type IconKind = 'ok' | 'crush' | 'bad' | 'belt' | 'down' | 'hint';

/** Icon inside a dark disc with a coloured ring, centred at (cx, cy), radius r (CSS px). */
export function drawIcon(ctx: CanvasRenderingContext2D, kind: IconKind, cx: number, cy: number, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(9,12,18,0.9)';
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.16);
  ctx.strokeStyle = color;
  ctx.stroke();

  const k = r * 0.52;
  ctx.lineWidth = Math.max(2, r * 0.24);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  switch (kind) {
    case 'ok':
      ctx.moveTo(cx - k * 0.95, cy + k * 0.05);
      ctx.lineTo(cx - k * 0.25, cy + k * 0.72);
      ctx.lineTo(cx + k * 0.95, cy - k * 0.62);
      ctx.stroke();
      break;
    case 'bad':
      ctx.moveTo(cx - k * 0.72, cy - k * 0.72);
      ctx.lineTo(cx + k * 0.72, cy + k * 0.72);
      ctx.moveTo(cx + k * 0.72, cy - k * 0.72);
      ctx.lineTo(cx - k * 0.72, cy + k * 0.72);
      ctx.stroke();
      break;
    case 'crush':
      // Exclamation mark.
      ctx.moveTo(cx, cy - k * 0.95);
      ctx.lineTo(cx, cy + k * 0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + k * 0.78, Math.max(1.2, r * 0.15), 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'belt':
      // Return arrow: down and to the left, onto the belt.
      ctx.moveTo(cx + k * 0.8, cy - k * 0.8);
      ctx.lineTo(cx + k * 0.8, cy + k * 0.15);
      ctx.lineTo(cx - k * 0.55, cy + k * 0.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - k * 0.95, cy + k * 0.15);
      ctx.lineTo(cx - k * 0.3, cy - k * 0.45);
      ctx.lineTo(cx - k * 0.3, cy + k * 0.75);
      ctx.closePath();
      ctx.fill();
      break;
    case 'down':
      ctx.moveTo(cx, cy - k * 0.9);
      ctx.lineTo(cx, cy + k * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - k * 0.75, cy + k * 0.05);
      ctx.lineTo(cx, cy + k * 0.95);
      ctx.lineTo(cx + k * 0.75, cy + k * 0.05);
      ctx.stroke();
      break;
    case 'hint':
      // Light bulb: globe, neck and base.
      ctx.arc(cx, cy - k * 0.25, k * 0.62, Math.PI * 0.8, Math.PI * 2.2);
      ctx.lineTo(cx + k * 0.28, cy + k * 0.45);
      ctx.lineTo(cx - k * 0.28, cy + k * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - k * 0.3, cy + k * 0.58, k * 0.6, k * 0.34);
      break;
  }
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}
