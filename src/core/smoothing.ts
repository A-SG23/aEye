/**
 * Landmark smoothing.
 *
 * MediaPipe re-solves every frame independently, so a perfectly still face
 * still produces sub-pixel jitter — and because the template is rebuilt from
 * those landmarks each frame, that jitter shows up as the wing fluttering and
 * creeping around on the lid.
 *
 * A plain exponential average would fix the flutter but add lag, so the
 * template would lag behind you as you lean in. This is the One Euro filter
 * instead: its cutoff rises with measured speed, so it smooths hard when you
 * are holding still and gets out of the way when you actually move.
 *
 * Reference: Casiez, Roussel & Vogel, "1€ Filter" (CHI 2012).
 */

/**
 * Tuning, in normalized landmark units (the frame is 0..1 across).
 *
 * MIN_CUTOFF sets how hard a stationary face is smoothed — lower is steadier
 * but laggier. BETA sets how fast the filter lets go once you move; it is
 * large because speeds expressed in normalized units are small numbers.
 */
const MIN_CUTOFF = 0.8;
const BETA = 25;
const D_CUTOFF = 1.0;

/** Fall back to this frame rate until two timestamps have been seen. */
const ASSUMED_RATE = 30;

function alphaFor(cutoff: number, rate: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau * rate);
}

class LowPass {
  private y: number | null = null;

  filter(x: number, alpha: number): number {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }

  reset(): void {
    this.y = null;
  }
}

class OneEuro {
  private value = new LowPass();
  private derivative = new LowPass();
  private lastSeconds: number | null = null;
  private lastValue: number | null = null;

  filter(x: number, seconds: number): number {
    let rate = ASSUMED_RATE;
    if (this.lastSeconds !== null) {
      const dt = seconds - this.lastSeconds;
      // Guard against a stalled or rewound clock.
      if (dt > 1e-4 && dt < 1) rate = 1 / dt;
    }
    this.lastSeconds = seconds;

    const speed = this.lastValue === null ? 0 : (x - this.lastValue) * rate;
    this.lastValue = x;

    const smoothedSpeed = this.derivative.filter(speed, alphaFor(D_CUTOFF, rate));
    const cutoff = MIN_CUTOFF + BETA * Math.abs(smoothedSpeed);
    return this.value.filter(x, alphaFor(cutoff, rate));
  }

  reset(): void {
    this.value.reset();
    this.derivative.reset();
    this.lastSeconds = null;
    this.lastValue = null;
  }
}

export interface SmoothablePoint {
  x: number;
  y: number;
  z?: number;
}

/**
 * Smooths a whole landmark array in place-equivalent fashion, returning a new
 * array. Filtering here rather than further downstream means the metrics, the
 * template and the debug overlay all see the same steady values.
 */
export class LandmarkSmoother {
  private filters: { x: OneEuro; y: OneEuro }[] = [];

  smooth<T extends SmoothablePoint>(points: T[], timestampMs: number): T[] {
    const seconds = timestampMs / 1000;

    if (this.filters.length !== points.length) {
      this.filters = points.map(() => ({ x: new OneEuro(), y: new OneEuro() }));
    }

    return points.map((p, i) => ({
      ...p,
      x: this.filters[i].x.filter(p.x, seconds),
      y: this.filters[i].y.filter(p.y, seconds),
    }));
  }

  /** Call whenever tracking drops, so the filter does not drag in from a stale pose. */
  reset(): void {
    for (const f of this.filters) {
      f.x.reset();
      f.y.reset();
    }
  }
}
