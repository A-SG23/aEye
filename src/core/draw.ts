/**
 * Canvas 2D overlay: the wing template always, the landmark debug cloud only
 * when metrics are showing.
 */
import {
  EYE_REGION_INDICES,
  IRIS_INDICES,
  LEFT_EYE,
  RIGHT_EYE,
  toCanvas,
  type EyeMetrics,
  type NormalizedPoint,
} from './landmarks.ts';
import type { WingGeometry } from './wing.ts';

/**
 * Trace the filled template outline onto a 2D context. Does not paint.
 *
 * Lives here rather than in wing.ts so that module stays free of DOM types —
 * the Node-side geometry checks import it and have no DOM lib.
 */
export function traceWing(ctx: CanvasRenderingContext2D, wing: WingGeometry): void {
  ctx.beginPath();
  ctx.moveTo(wing.upperAnchor.x, wing.upperAnchor.y);
  ctx.quadraticCurveTo(wing.upperControl.x, wing.upperControl.y, wing.tip.x, wing.tip.y);
  ctx.quadraticCurveTo(
    wing.lowerControl.x,
    wing.lowerControl.y,
    wing.lowerAnchor.x,
    wing.lowerAnchor.y,
  );
  for (const p of wing.lidReturn) ctx.lineTo(p.x, p.y);
  ctx.closePath();
}

/**
 * Canvas colours. The template values mirror the tokens in theme.css — canvas
 * cannot read CSS custom properties, so they are duplicated here deliberately.
 * The debug-cloud colours are intentionally NOT on-brand: they are diagnostic
 * and want to be loud against both the face and the template.
 */
export const COLORS = {
  mesh: 'rgba(120, 220, 255, 0.5)',
  eye: '#ff3d81',
  iris: '#ffd166',
  canthus: '#00ff9d',
  lid: '#ffffff',
  /** --green-bright: the iris highlight, chosen to survive skin tones. */
  template: '#95b300',
  templateFill: 'rgba(116, 134, 45, 0.28)',
  /** --green-deep, as a dark under-stroke so the edge holds on pale skin too. */
  templateEdge: 'rgba(67, 77, 26, 0.55)',
  templateFrozen: '#8c5e88',
  templateFrozenFill: 'rgba(140, 94, 136, 0.2)',
} as const;

const MESH_DOT = 1.1;
const EYE_DOT = 2.0;
const KEY_DOT = 3.4;

export interface OverlayInput {
  landmarks: NormalizedPoint[] | null;
  metrics: { left: EyeMetrics | null; right: EyeMetrics | null };
  wings: { left: WingGeometry | null; right: WingGeometry | null };
  /** Debug landmark cloud. Tied to the metrics toggle. */
  showLandmarks: boolean;
  /** Template is holding its last good position because tracking degraded. */
  templateFrozen: boolean;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, input: OverlayInput): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  if (input.showLandmarks && input.landmarks) {
    drawLandmarks(ctx, input.landmarks, input.metrics, width, height);
  }

  for (const wing of [input.wings.right, input.wings.left]) {
    if (wing) drawTemplate(ctx, wing, input.templateFrozen);
  }
}

/**
 * The template. Filled enough to see the shape, transparent enough to see the
 * lid underneath — the point is to trace it, not to hide the eye.
 */
function drawTemplate(
  ctx: CanvasRenderingContext2D,
  wing: WingGeometry,
  frozen: boolean,
): void {
  traceWing(ctx, wing);
  ctx.fillStyle = frozen ? COLORS.templateFrozenFill : COLORS.templateFill;
  ctx.fill();

  // Dark under-stroke so the edge survives against pale skin too.
  ctx.strokeStyle = COLORS.templateEdge;
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.strokeStyle = frozen ? COLORS.templateFrozen : COLORS.template;
  ctx.lineWidth = 2;
  if (frozen) ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedPoint[],
  metrics: { left: EyeMetrics | null; right: EyeMetrics | null },
  width: number,
  height: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < landmarks.length; i++) {
    if (EYE_REGION_INDICES.has(i) || IRIS_INDICES.has(i)) continue;
    const p = toCanvas(landmarks[i], width, height);
    ctx.moveTo(p.x + MESH_DOT, p.y);
    ctx.arc(p.x, p.y, MESH_DOT, 0, Math.PI * 2);
  }
  ctx.fillStyle = COLORS.mesh;
  ctx.fill();

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

  for (const eye of [metrics.right, metrics.left]) {
    if (!eye) continue;
    ctx.beginPath();
    ctx.moveTo(eye.inner.x, eye.inner.y);
    ctx.lineTo(eye.outer.x, eye.outer.y);
    ctx.strokeStyle = 'rgba(0, 255, 157, 0.9)';
    ctx.lineWidth = 1.25;
    ctx.stroke();

    dot(ctx, eye.outer, COLORS.canthus);
    dot(ctx, eye.inner, COLORS.canthus);
    dot(ctx, eye.upper, COLORS.lid);
    dot(ctx, eye.lower, COLORS.lid);
  }

  drawRing(ctx, landmarks, RIGHT_EYE.ring, width, height);
  drawRing(ctx, landmarks, LEFT_EYE.ring, width, height);
}

function drawRing(
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

function dot(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, color: string): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, KEY_DOT, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
}
