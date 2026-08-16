/**
 * M1 — wing anchor geometry.
 *
 * The wing is stored in terms of the face, not the image:
 *
 *   origin  the outer canthus (landmark 33 / 263)
 *   angle   an OFFSET above the measured canthal axis, in degrees
 *   length  a FRACTION of the measured eye width
 *
 * Storing it this way is what makes it survive the two things that otherwise
 * break a template: head roll, and the difference between one face and the
 * next. An absolute image-space angle would tilt with the head; an absolute
 * pixel length would not scale between users or camera distances.
 *
 * Everything resolves to pixels only at draw time, from the live measurement.
 */
// Explicit extension: this module is also pulled into the Node-side check
// project, where nodenext resolution requires it.
import type { CanvasPoint, EyeMetrics } from './landmarks.ts';

export interface WingSpec {
  /** Degrees ABOVE the canthal axis. Positive lifts the tip. */
  angleOffsetDeg: number;
  /** Tip distance from the outer canthus, as a fraction of eye width. */
  lengthRatio: number;
}

/**
 * Placeholder values until the parameter controls exist. Chosen to sit in the
 * ordinary range for a winged liner rather than to be correct for any face.
 */
export const DEFAULT_WING: WingSpec = {
  angleOffsetDeg: 20,
  lengthRatio: 0.3,
};

export interface WingGeometry {
  /** Outer canthus, in canvas pixels. */
  origin: CanvasPoint;
  /** Where the wing ends. */
  tip: CanvasPoint;
  /** Resolved tip distance in canvas pixels. */
  lengthPx: number;
  /** The canthal axis this was measured against, in EyeMetrics.angleDeg terms. */
  canthalAngleDeg: number;
  /**
   * The wing axis in that same convention — canthal axis plus the offset.
   * Positive means the tip sits above the outer canthus.
   */
  wingAngleDeg: number;
}

/**
 * Resolve a spec against a live eye measurement.
 *
 * The direction is built from `eye.angleDeg + offset` rather than from a raw
 * vector rotation, so it inherits the mirror-safe sign convention that
 * `measureEye` already establishes: positive is "tip up" for both eyes, even
 * though the two eyes point in opposite directions across the screen.
 */
export function resolveWing(eye: EyeMetrics, spec: WingSpec): WingGeometry {
  const wingAngleDeg = eye.angleDeg + spec.angleOffsetDeg;
  const radians = (wingAngleDeg * Math.PI) / 180;

  // Which way is "away from the nose" on screen for this eye. Canvas y grows
  // downward, so a positive angle has to push y negative.
  const outward = Math.sign(eye.outer.x - eye.inner.x) || 1;
  const lengthPx = eye.widthPx * spec.lengthRatio;

  return {
    origin: eye.outer,
    tip: {
      x: eye.outer.x + outward * Math.cos(radians) * lengthPx,
      y: eye.outer.y - Math.sin(radians) * lengthPx,
    },
    lengthPx,
    canthalAngleDeg: eye.angleDeg,
    wingAngleDeg,
  };
}
