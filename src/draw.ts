/**
 * Canvas 2D overlay. Draws the full landmark cloud, tints the eye region, and
 * marks the four points each eye's measurements come from.
 */
import {
  EYE_REGION_INDICES,
  IRIS_INDICES,
  LEFT_EYE,
  RIGHT_EYE,
  toCanvas,
  type EyeMetrics,
  type NormalizedPoint,
} from './landmarks';
import type { WingGeometry } from './wing';

export const COLORS = {
  mesh: 'rgba(120, 220, 255, 0.55)',
  eye: '#ff3d81',
  iris: '#ffd166',
  canthus: '#00ff9d',
  lid: '#ffffff',
  axis: 'rgba(0, 255, 157, 0.9)',
  wing: '#c084fc',
} as const;

const MESH_DOT = 1.1;
const EYE_DOT = 2.0;
const KEY_DOT = 3.4;

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedPoint[] | null,
  metrics: { left: EyeMetrics | null; right: EyeMetrics | null },
  wings: { left: WingGeometry | null; right: WingGeometry | null } = {
    left: null,
    right: null,
  },
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  if (!landmarks || landmarks.length === 0) return;

  // Pass 1: the full mesh, batched into a single path so 468+ dots stay cheap.
  ctx.beginPath();
  for (let i = 0; i < landmarks.length; i++) {
    if (EYE_REGION_INDICES.has(i) || IRIS_INDICES.has(i)) continue;
    const p = toCanvas(landmarks[i], width, height);
    ctx.moveTo(p.x + MESH_DOT, p.y);
    ctx.arc(p.x, p.y, MESH_DOT, 0, Math.PI * 2);
  }
  ctx.fillStyle = COLORS.mesh;
  ctx.fill();

  // Pass 2: eye-region ring, in its own color.
  ctx.beginPath();
  for (const i of EYE_REGION_INDICES) {
    const lm = landmarks[i];
    if (!lm) continue;
    const p = toCanvas(lm, width, height);
    ctx.moveTo(p.x + EYE_DOT, p.y);
    ctx.arc(p.x, p.y, EYE_DOT, 0, Math.PI * 2);
  }
  ctx.fillStyle = COLORS.eye;
  ctx.fill();

  // Pass 3: iris, when the 478-point model is in use.
  ctx.beginPath();
  let hasIris = false;
  for (const i of IRIS_INDICES) {
    const lm = landmarks[i];
    if (!lm) continue;
    hasIris = true;
    const p = toCanvas(lm, width, height);
    ctx.moveTo(p.x + EYE_DOT, p.y);
    ctx.arc(p.x, p.y, EYE_DOT, 0, Math.PI * 2);
  }
  if (hasIris) {
    ctx.fillStyle = COLORS.iris;
    ctx.fill();
  }

  // Pass 4: the measured points and the canthal axis, so the numbers in the
  // readout can be checked against something visible.
  for (const eye of [metrics.right, metrics.left]) {
    if (!eye) continue;
    drawAxis(ctx, eye);
    drawKeyPoint(ctx, eye.outer, COLORS.canthus);
    drawKeyPoint(ctx, eye.inner, COLORS.canthus);
    drawKeyPoint(ctx, eye.upper, COLORS.lid);
    drawKeyPoint(ctx, eye.lower, COLORS.lid);
  }

  drawEyeRing(ctx, landmarks, RIGHT_EYE.ring, width, height);
  drawEyeRing(ctx, landmarks, LEFT_EYE.ring, width, height);

  // Pass 5: M1 wing anchors, on top of everything.
  for (const wing of [wings.right, wings.left]) {
    if (wing) drawWing(ctx, wing);
  }
}

/**
 * The wing axis: outer canthus out to the tip. Drawn with the canthal axis it
 * was measured from, so the offset between them is visible rather than implied.
 */
function drawWing(ctx: CanvasRenderingContext2D, wing: WingGeometry): void {
  ctx.beginPath();
  ctx.moveTo(wing.origin.x, wing.origin.y);
  ctx.lineTo(wing.tip.x, wing.tip.y);
  ctx.strokeStyle = COLORS.wing;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.lineCap = 'butt';

  ctx.beginPath();
  ctx.arc(wing.tip.x, wing.tip.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.wing;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawEyeRing(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedPoint[],
  ring: readonly number[],
  width: number,
  height: number,
): void {
  if (ring.some((i) => landmarks[i] === undefined)) return;
  ctx.beginPath();
  ring.forEach((index, n) => {
    const p = toCanvas(landmarks[index], width, height);
    if (n === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.strokeStyle = 'rgba(255, 61, 129, 0.65)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawAxis(ctx: CanvasRenderingContext2D, eye: EyeMetrics): void {
  ctx.beginPath();
  ctx.moveTo(eye.inner.x, eye.inner.y);
  ctx.lineTo(eye.outer.x, eye.outer.y);
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.25;
  ctx.stroke();

  // Horizontal reference through the inner canthus, so the tilt is legible.
  const dir = Math.sign(eye.outer.x - eye.inner.x) || 1;
  ctx.beginPath();
  ctx.moveTo(eye.inner.x, eye.inner.y);
  ctx.lineTo(eye.inner.x + dir * eye.widthPx, eye.inner.y);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawKeyPoint(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number },
  color: string,
): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, KEY_DOT, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
}
