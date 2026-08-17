/**
 * Wing template geometry.
 *
 * The template is stored ONLY as dimensionless ratios in the eye's own
 * measured frame — never as pixel coordinates and never as absolute angles.
 * At render time it is rebuilt from the current frame's landmarks, which is
 * what lets it survive head tilt, camera distance, and mirroring.
 *
 * The eye frame is the whole trick:
 *
 *   origin  the outer canthus
 *   u       unit vector along the canthal axis, pointing AWAY from the nose
 *   v       unit vector perpendicular to u, pointing UP toward the brow
 *   scale   eye width in pixels
 *
 * Both basis vectors are defined per eye, so u already points outward on
 * whichever side of the face the eye is. A point written as (a, b) in that
 * frame therefore lands in mirrored positions on the two eyes from the SAME
 * numbers — which is why §4.4 needs no sign flip and no pixel mirroring.
 */
import {
  pathPoints,
  pathUpTo,
  pointAlongPath,
  upperLidPath,
  type CanvasPoint,
  type EyeIndices,
  type EyeMetrics,
  type NormalizedPoint,
} from './landmarks.ts';

/** Everything that defines a wing. Every field is dimensionless. */
export interface WingParams {
  /** Tip distance from the outer canthus, as a fraction of eye width. */
  tipLength: number;
  /** Tip direction, in degrees offset from the measured canthal axis. */
  tipAngleDeg: number;
  /** Upper control point offset from its chord, as a fraction of chord length. */
  upperCurvature: number;
  /** Lower control point offset from its chord, as a fraction of chord length. */
  lowerCurvature: number;
  /** Upper anchor position along the lid margin, from the outer canthus. */
  upperAnchorRatio: number;
}

export const DEFAULT_WING: WingParams = {
  tipLength: 0.34,
  tipAngleDeg: 24,
  upperCurvature: 0.14,
  lowerCurvature: -0.05,
  upperAnchorRatio: 0.28,
};

export const WING_LIMITS = {
  tipLength: { min: 0.05, max: 1.2 },
  tipAngleDeg: { min: -30, max: 75 },
  upperCurvature: { min: -0.6, max: 0.6 },
  lowerCurvature: { min: -0.6, max: 0.6 },
  upperAnchorRatio: { min: 0.05, max: 0.85 },
} as const;

export function clampParams(p: WingParams): WingParams {
  const c = (v: number, k: keyof typeof WING_LIMITS) =>
    Math.max(WING_LIMITS[k].min, Math.min(WING_LIMITS[k].max, v));
  return {
    tipLength: c(p.tipLength, 'tipLength'),
    tipAngleDeg: c(p.tipAngleDeg, 'tipAngleDeg'),
    upperCurvature: c(p.upperCurvature, 'upperCurvature'),
    lowerCurvature: c(p.lowerCurvature, 'lowerCurvature'),
    upperAnchorRatio: c(p.upperAnchorRatio, 'upperAnchorRatio'),
  };
}

interface Vec2 {
  x: number;
  y: number;
}

/** A point in the eye's local frame, in units of eye width. */
export interface LocalPoint {
  a: number;
  b: number;
}

export interface EyeFrame {
  origin: CanvasPoint;
  u: Vec2;
  v: Vec2;
  scale: number;
}

/**
 * Build the local frame from a live measurement.
 *
 * `eye.angleDeg` is already the mirror-safe canthal tilt (positive = outer
 * corner higher), so u is reconstructed from it rather than from a raw
 * difference vector — that keeps this consistent with every other angle in
 * the app.
 */
export function eyeFrame(eye: EyeMetrics): EyeFrame {
  const outward = Math.sign(eye.outer.x - eye.inner.x) || 1;
  const radians = (eye.angleDeg * Math.PI) / 180;
  const u = { x: outward * Math.cos(radians), y: -Math.sin(radians) };
  // Perpendicular to u, pointing toward the brow on both eyes.
  const v = { x: outward * u.y, y: -outward * u.x };
  return { origin: eye.outer, u, v, scale: eye.widthPx };
}

export function localToCanvas(frame: EyeFrame, p: LocalPoint): CanvasPoint {
  const a = p.a * frame.scale;
  const b = p.b * frame.scale;
  return {
    x: frame.origin.x + a * frame.u.x + b * frame.v.x,
    y: frame.origin.y + a * frame.u.y + b * frame.v.y,
  };
}

export function canvasToLocal(frame: EyeFrame, p: CanvasPoint): LocalPoint {
  const dx = p.x - frame.origin.x;
  const dy = p.y - frame.origin.y;
  // u and v are orthonormal, so the inverse is just a pair of dot products.
  return {
    a: (dx * frame.u.x + dy * frame.u.y) / frame.scale,
    b: (dx * frame.v.x + dy * frame.v.y) / frame.scale,
  };
}

export interface WingGeometry {
  frame: EyeFrame;
  /** Outer canthus. Landmark-locked, not draggable. */
  lowerAnchor: CanvasPoint;
  /** On the lid margin at upperAnchorRatio. Landmark-locked, not draggable. */
  upperAnchor: CanvasPoint;
  tip: CanvasPoint;
  upperControl: CanvasPoint;
  lowerControl: CanvasPoint;
  /** Lid margin from the upper anchor back to the outer canthus, closing the fill. */
  lidReturn: CanvasPoint[];
}

/**
 * Rebuild a wing in pixels from the ratios plus this frame's landmarks.
 *
 * All intermediate maths happens in local coordinates and only converts to
 * canvas at the end, so mirror symmetry is structural rather than something
 * we have to remember to handle.
 */
export function resolveWing(
  landmarks: NormalizedPoint[],
  indices: EyeIndices,
  eye: EyeMetrics,
  params: WingParams,
  width: number,
  height: number,
): WingGeometry | null {
  const lid = pathPoints(landmarks, upperLidPath(indices), width, height);
  if (!lid) return null;

  const frame = eyeFrame(eye);
  if (!Number.isFinite(frame.scale) || frame.scale <= 0) return null;

  const upperAnchor = pointAlongPath(lid, params.upperAnchorRatio);
  const lowerAnchor = eye.outer;

  const radians = (params.tipAngleDeg * Math.PI) / 180;
  const tipLocal: LocalPoint = {
    a: params.tipLength * Math.cos(radians),
    b: params.tipLength * Math.sin(radians),
  };

  const upperLocal = controlPoint(canvasToLocal(frame, upperAnchor), tipLocal, params.upperCurvature);
  const lowerLocal = controlPoint({ a: 0, b: 0 }, tipLocal, params.lowerCurvature);

  return {
    frame,
    lowerAnchor,
    upperAnchor,
    tip: localToCanvas(frame, tipLocal),
    upperControl: localToCanvas(frame, upperLocal),
    lowerControl: localToCanvas(frame, lowerLocal),
    // Reversed so the fill path runs tip -> lower anchor -> back along the lid.
    lidReturn: pathUpTo(lid, params.upperAnchorRatio).reverse(),
  };
}

/**
 * Control point for a quadratic Bézier: the chord midpoint pushed
 * perpendicular by `curvature` times the chord length.
 *
 * In local coordinates +b is "up", and rotating a chord by +90 degrees maps
 * (1,0) to (0,1), so a positive curvature always bows the curve toward the
 * brow — on both eyes, at any head angle.
 */
function controlPoint(anchor: LocalPoint, tip: LocalPoint, curvature: number): LocalPoint {
  const da = tip.a - anchor.a;
  const db = tip.b - anchor.b;
  const len = Math.hypot(da, db);
  const mid = { a: (anchor.a + tip.a) / 2, b: (anchor.b + tip.b) / 2 };
  if (len === 0) return mid;
  const perp = { a: -db / len, b: da / len };
  return { a: mid.a + perp.a * curvature * len, b: mid.b + perp.b * curvature * len };
}

/**
 * Recover a curvature ratio from a dragged control point.
 * Only the perpendicular component is kept — the along-chord component is not
 * part of the stored model, so sliding a handle along its chord is a no-op.
 */
export function curvatureFromPoint(
  anchor: LocalPoint,
  tip: LocalPoint,
  dragged: LocalPoint,
): number {
  const da = tip.a - anchor.a;
  const db = tip.b - anchor.b;
  const len = Math.hypot(da, db);
  if (len === 0) return 0;
  const mid = { a: (anchor.a + tip.a) / 2, b: (anchor.b + tip.b) / 2 };
  const perp = { a: -db / len, b: da / len };
  return ((dragged.a - mid.a) * perp.a + (dragged.b - mid.b) * perp.b) / len;
}
