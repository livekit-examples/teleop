import type { HandTeleop, Sighting } from './hand-teleop';
import { BONES } from './math';

/** Draw the mirrored webcam frame, each hand's skeleton, and a label for each arm. */
export function drawHands(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  sighting: Sighting | null,
  teleop: HandTeleop,
) {
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -w, 0, w, h);
  ctx.restore();
  for (const side of ['left', 'right'] as const) {
    const view = teleop.view(side);
    if (!view.image || !sighting) continue;
    const pts = view.image.map(([x, y]) => [w - x, y] as const);
    const colour = view.gripping ? '#2ecc71' : '#f1c40f';
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a, b] of BONES) {
      ctx.moveTo(pts[a][0], pts[a][1]);
      ctx.lineTo(pts[b][0], pts[b][1]);
    }
    ctx.stroke();
    ctx.fillStyle = colour;
    for (const [x, y] of pts) ctx.fillRect(x - 2, y - 2, 4, 4);
    const top = Math.min(...pts.map((p) => p[1]));
    const left = Math.min(...pts.map((p) => p[0]));
    const text = view.gripping
      ? `${side}: ${view.moved.map((v) => Math.round(v * 1000)).join(', ')} mm · ${Math.round((view.turned * 180) / Math.PI)}° · grip ${Math.round(view.grip * 100)}%${view.waiting ? ' (waiting)' : ''}`
      : `${side}: curl ${view.curl ? view.curl.map((c) => c.toFixed(1)).join(' ') : '-'}`;
    const textX = Math.max(4, left);
    const textY = Math.max(16, top - 8);
    ctx.font = '14px sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(text, textX, textY);
    ctx.fillStyle = colour;
    ctx.fillText(text, textX, textY);
  }
}
