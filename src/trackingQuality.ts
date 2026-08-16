/**
 * A DERIVED tracking-quality score.
 *
 * Important: the MediaPipe Tasks `FaceLandmarkerResult` exposes no confidence
 * value. It carries only `faceLandmarks`, `faceBlendshapes` and
 * `facialTransformationMatrixes`. The `minFaceDetectionConfidence` /
 * `minTrackingConfidence` options gate detection internally, but the score
 * itself is never surfaced to JS.
 *
 * So this is not the model's confidence — it is a proxy assembled from signals
 * we can actually observe. The three components are reported separately so a
 * low score is diagnosable rather than mysterious.
 */
import type { NormalizedPoint } from './landmarks';

/** Frames of history used for the rolling detection rate. */
const WINDOW = 30;

/**
 * Per-frame normalized landmark displacement treated as "fully unstable".
 * A still face sits around 0.001; this ceiling is deliberately generous so
 * ordinary head movement does not read as tracking failure.
 */
const JITTER_CEIL = 0.02;

export interface TrackingQuality {
  /** Composite 0..1. Derived, not from the model. */
  score: number;
  /** Fraction of the last WINDOW frames that produced a face. */
  detectionRate: number;
  /** Fraction of landmarks inside the frame bounds. Falls when the face crops. */
  inFrameRatio: number;
  /** 1 = still, 0 = jitter at or above JITTER_CEIL. Head motion lowers this too. */
  stability: number;
  /** Whether a face was found on the most recent frame. */
  present: boolean;
}

export class TrackingQualityMeter {
  private history: boolean[] = [];
  private previous: NormalizedPoint[] | null = null;
  private inFrameRatio = 0;
  private stability = 0;

  update(landmarks: NormalizedPoint[] | null): TrackingQuality {
    const present = landmarks !== null && landmarks.length > 0;

    this.history.push(present);
    if (this.history.length > WINDOW) this.history.shift();

    if (present && landmarks) {
      this.inFrameRatio = computeInFrameRatio(landmarks);
      this.stability = this.computeStability(landmarks);
      this.previous = landmarks;
    } else {
      // Decay rather than snap to zero, so a single dropped frame does not
      // make the readout flash.
      this.inFrameRatio *= 0.5;
      this.stability *= 0.5;
      this.previous = null;
    }

    const detectionRate =
      this.history.length === 0
        ? 0
        : this.history.filter(Boolean).length / this.history.length;

    const score = detectionRate * (0.5 * this.inFrameRatio + 0.5 * this.stability);

    return {
      score,
      detectionRate,
      inFrameRatio: this.inFrameRatio,
      stability: this.stability,
      present,
    };
  }

  private computeStability(landmarks: NormalizedPoint[]): number {
    const prev = this.previous;
    if (!prev || prev.length !== landmarks.length) return 1;

    let total = 0;
    for (let i = 0; i < landmarks.length; i++) {
      total += Math.hypot(landmarks[i].x - prev[i].x, landmarks[i].y - prev[i].y);
    }
    const mean = total / landmarks.length;
    return clamp01(1 - mean / JITTER_CEIL);
  }

  reset(): void {
    this.history = [];
    this.previous = null;
    this.inFrameRatio = 0;
    this.stability = 0;
  }
}

/**
 * MediaPipe happily extrapolates landmarks past the edge of the image, so
 * out-of-bounds coordinates are the signal that the face is partly cropped —
 * which is exactly what happens when you lean close to the camera.
 */
function computeInFrameRatio(landmarks: NormalizedPoint[]): number {
  if (landmarks.length === 0) return 0;
  let inside = 0;
  for (const p of landmarks) {
    if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) inside++;
  }
  return inside / landmarks.length;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export interface MetricRange {
  min: number;
  max: number;
}

export interface RangeSnapshot {
  /** Frames accumulated since the last reset. */
  samples: number;
  ranges: Record<string, MetricRange>;
}

export const EMPTY_RANGES: RangeSnapshot = { samples: 0, ranges: {} };

/**
 * Min/max capture across a run.
 *
 * Accumulates at full frame rate — not at the 10 Hz the readout refreshes —
 * so a brief dip while leaning in still registers. Nothing here is displayed
 * live; the point is to read the extremes afterwards, when your face is no
 * longer six inches from the panel.
 */
export class RangeAccumulator {
  private ranges = new Map<string, MetricRange>();
  private samples = 0;

  observe(key: string, value: number | null | undefined): void {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    const existing = this.ranges.get(key);
    if (existing === undefined) {
      this.ranges.set(key, { min: value, max: value });
      return;
    }
    if (value < existing.min) existing.min = value;
    if (value > existing.max) existing.max = value;
  }

  countSample(): void {
    this.samples++;
  }

  snapshot(): RangeSnapshot {
    const ranges: Record<string, MetricRange> = {};
    for (const [key, range] of this.ranges) ranges[key] = { ...range };
    return { samples: this.samples, ranges };
  }

  reset(): void {
    this.ranges.clear();
    this.samples = 0;
  }
}

/**
 * Split the two per-eye tilt readings into the parts that matter.
 *
 * Because the angle sign is normalized per eye, a head roll moves the two eyes
 * in OPPOSITE directions while a genuine canthal tilt moves them the SAME way.
 * So the mean is roll-invariant and recovers true tilt, and the half-difference
 * recovers the roll. Verified in scripts/landmarks.check.ts.
 */
export function decomposeAngles(
  rightAngleDeg: number,
  leftAngleDeg: number,
): { canthalTiltDeg: number; headRollDeg: number } {
  return {
    canthalTiltDeg: (rightAngleDeg + leftAngleDeg) / 2,
    headRollDeg: (rightAngleDeg - leftAngleDeg) / 2,
  };
}

/**
 * Rolling FPS over a short window of frame timestamps.
 *
 * Returns 0 until the window has warmed up. The first couple of frames after
 * startup are hundreds of milliseconds apart, and reporting that as a real
 * reading parks a meaningless low value in the captured minimum.
 */
export class FpsMeter {
  private static readonly MIN_SAMPLES = 5;
  private stamps: number[] = [];

  tick(now: number): number {
    this.stamps.push(now);
    while (this.stamps.length > 0 && now - this.stamps[0] > 1000) {
      this.stamps.shift();
    }
    if (this.stamps.length < FpsMeter.MIN_SAMPLES) return 0;
    const span = this.stamps[this.stamps.length - 1] - this.stamps[0];
    return span === 0 ? 0 : ((this.stamps.length - 1) * 1000) / span;
  }

  reset(): void {
    this.stamps = [];
  }
}
