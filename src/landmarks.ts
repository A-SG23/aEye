/**
 * Eye landmark indices and the geometry M0 reports.
 *
 * Indices below were extracted from the shipped MediaPipe constants
 * (`FaceLandmarker.FACE_LANDMARKS_LEFT_EYE` / `..._RIGHT_EYE`) rather than
 * copied from a blog post — see README "Landmark indices" for the walk order.
 *
 * Naming is ANATOMICAL (the subject's own left/right). The preview is mirrored,
 * which — like a real mirror — preserves left/right position: the subject's
 * right eye appears on the RIGHT-hand side of the screen. (An unmirrored camera
 * frame is the opposite, since it shows you as a person facing you would look.)
 * Verified in landmarks.check.ts.
 */

/** A landmark in MediaPipe's normalized image space: x,y in [0,1], origin top-left. */
export interface NormalizedPoint {
  x: number;
  y: number;
  z?: number;
}

/** A point in canvas pixel space, already mirrored for the selfie preview. */
export interface CanvasPoint {
  x: number;
  y: number;
}

export interface EyeIndices {
  /** Lateral canthus — the outer corner, toward the ear. Where a wing starts. */
  outerCanthus: number;
  /** Medial canthus — the inner corner, toward the nose. */
  innerCanthus: number;
  /** Apex of the upper lid margin. */
  upperLid: number;
  /** Nadir of the lower lid margin. */
  lowerLid: number;
  /** Full 16-point lid ring, in walk order starting at the outer canthus. */
  ring: readonly number[];
}

/**
 * Subject's RIGHT eye. Appears on the RIGHT of the mirrored preview.
 * Ring walks: outer canthus -> upper lid -> inner canthus -> lower lid -> back.
 */
export const RIGHT_EYE: EyeIndices = {
  outerCanthus: 33,
  innerCanthus: 133,
  upperLid: 159,
  lowerLid: 145,
  ring: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
};

/**
 * Subject's LEFT eye. Appears on the LEFT of the mirrored preview.
 */
export const LEFT_EYE: EyeIndices = {
  outerCanthus: 263,
  innerCanthus: 362,
  upperLid: 386,
  lowerLid: 374,
  ring: [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
};

/** Iris ring centers, present only when the model emits 478 landmarks. */
export const RIGHT_IRIS: readonly number[] = [469, 470, 471, 472];
export const LEFT_IRIS: readonly number[] = [474, 475, 476, 477];

/** Every index we tint as "eye region", for the highlight pass. */
export const EYE_REGION_INDICES: ReadonlySet<number> = new Set<number>([
  ...RIGHT_EYE.ring,
  ...LEFT_EYE.ring,
]);

export const IRIS_INDICES: ReadonlySet<number> = new Set<number>([...RIGHT_IRIS, ...LEFT_IRIS]);

/**
 * Normalized -> canvas pixels, flipping x for the mirrored preview.
 * Mirroring here (rather than via a canvas transform) keeps any text we draw
 * upright and keeps the drawn dots aligned with the CSS-mirrored <video>.
 */
export function toCanvas(
  point: NormalizedPoint,
  width: number,
  height: number,
): CanvasPoint {
  return { x: (1 - point.x) * width, y: point.y * height };
}

export interface EyeMetrics {
  /** Inner-to-outer canthus distance, in canvas pixels. */
  widthPx: number;
  /** Upper-lid to lower-lid distance, in canvas pixels. */
  heightPx: number;
  /**
   * Canthal tilt in degrees from horizontal.
   * POSITIVE means the outer corner sits HIGHER than the inner corner — the
   * "upturned" direction a wing follows. Sign is normalized so both eyes read
   * the same way, and so mirroring the preview does not flip it.
   */
  angleDeg: number;
  /** Height / width. Drops toward 0 on a blink. */
  aspectRatio: number;
  outer: CanvasPoint;
  inner: CanvasPoint;
  upper: CanvasPoint;
  lower: CanvasPoint;
}

export function measureEye(
  landmarks: NormalizedPoint[],
  eye: EyeIndices,
  width: number,
  height: number,
): EyeMetrics | null {
  const needed = [eye.outerCanthus, eye.innerCanthus, eye.upperLid, eye.lowerLid];
  if (needed.some((i) => landmarks[i] === undefined)) return null;

  const outer = toCanvas(landmarks[eye.outerCanthus], width, height);
  const inner = toCanvas(landmarks[eye.innerCanthus], width, height);
  const upper = toCanvas(landmarks[eye.upperLid], width, height);
  const lower = toCanvas(landmarks[eye.lowerLid], width, height);

  const widthPx = Math.hypot(outer.x - inner.x, outer.y - inner.y);
  const heightPx = Math.hypot(upper.x - lower.x, upper.y - lower.y);

  // Measure against the horizontal run regardless of which way the eye points,
  // then let the vertical difference carry the sign. Canvas y grows downward,
  // so "outer is higher" means innerY - outerY > 0.
  const horizontalRun = Math.abs(outer.x - inner.x);
  const rise = inner.y - outer.y;
  const angleDeg = (Math.atan2(rise, horizontalRun) * 180) / Math.PI;

  return {
    widthPx,
    heightPx,
    angleDeg,
    aspectRatio: widthPx === 0 ? 0 : heightPx / widthPx,
    outer,
    inner,
    upper,
    lower,
  };
}
