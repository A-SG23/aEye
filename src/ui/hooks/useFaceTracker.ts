/**
 * React binding for core/faceTracker.ts: owns the element refs and mirrors the
 * tracker's events into state. All tracking logic lives in the core class.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EMPTY_STATS,
  FaceTracker,
  type StillFrame,
  type TrackerOptions,
  type TrackerStats,
  type TrackerStatus,
} from '../../core/faceTracker.ts';

export type { StillFrame, TrackerOptions, TrackerStats, TrackerStatus };

export function useFaceTracker(options: TrackerOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState<TrackerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<TrackerStats>(EMPTY_STATS);
  const [frozen, setFrozen] = useState(false);

  // One tracker for the component's lifetime; setters are stable, so the
  // events wired here never go stale.
  const trackerRef = useRef<FaceTracker | null>(null);
  trackerRef.current ??= new FaceTracker(
    { video: () => videoRef.current, canvas: () => canvasRef.current },
    { onStatus: setStatus, onError: setError, onStats: setStats, onFrozen: setFrozen },
  );
  const tracker = trackerRef.current;
  tracker.options = options;

  const start = useCallback(() => tracker.start(), [tracker]);
  const stop = useCallback(() => tracker.stop(), [tracker]);
  const resetRanges = useCallback(() => tracker.resetRanges(), [tracker]);
  const toggleFreeze = useCallback(() => tracker.toggleFreeze(), [tracker]);
  const captureStill = useCallback(() => tracker.captureStill(), [tracker]);

  useEffect(() => stop, [stop]);

  return {
    videoRef,
    canvasRef,
    status,
    error,
    stats,
    frozen,
    start,
    stop,
    resetRanges,
    toggleFreeze,
    captureStill,
  };
}
