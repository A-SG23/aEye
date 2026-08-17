/**
 * Owns the webcam stream, the Face Landmarker, and the per-frame loop.
 *
 * Everything here is client-side: the MediaStream goes straight into a <video>,
 * frames are handed to the wasm runtime in-process, and nothing is uploaded.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import {
  LEFT_EYE,
  RIGHT_EYE,
  measureEye,
  type EyeMetrics,
  type NormalizedPoint,
} from './landmarks.ts';
import { resolveWing, type WingGeometry, type WingParams } from './wing.ts';
import { drawOverlay } from './draw.ts';
import {
  EMPTY_RANGES,
  FpsMeter,
  RangeAccumulator,
  TemplateGate,
  TrackingQualityMeter,
  decomposeAngles,
  type GateState,
  type RangeSnapshot,
  type TrackingQuality,
} from './trackingQuality.ts';

export type TrackerStatus = 'idle' | 'starting' | 'running' | 'error';

/**
 * requestVideoFrameCallback is typed as always-present but is genuinely missing
 * in some browsers, so it needs a runtime check.
 */
function hasVideoFrameCallback(video: HTMLVideoElement): boolean {
  return typeof video.requestVideoFrameCallback === 'function';
}

/** A frozen frame plus the landmarks that went with it, for the designer. */
export interface StillFrame {
  canvas: HTMLCanvasElement;
  landmarks: NormalizedPoint[];
  width: number;
  height: number;
}

export interface TrackerStats {
  fps: number;
  quality: TrackingQuality;
  gate: GateState;
  left: EyeMetrics | null;
  right: EyeMetrics | null;
  landmarkCount: number;
  frameSize: { width: number; height: number };
  delegate: 'GPU' | 'CPU' | null;
  canthalTiltDeg: number | null;
  headRollDeg: number | null;
  /** True when the template is holding its last good position. */
  templateFrozen: boolean;
  ranges: RangeSnapshot;
}

const EMPTY_STATS: TrackerStats = {
  fps: 0,
  quality: { score: 0, detectionRate: 0, inFrameRatio: 0, stability: 0, present: false },
  gate: { ok: false, reasons: [], disagreementDeg: 0, disagreementVolatilityDeg: 0 },
  left: null,
  right: null,
  landmarkCount: 0,
  frameSize: { width: 0, height: 0 },
  delegate: null,
  canthalTiltDeg: null,
  headRollDeg: null,
  templateFrozen: false,
  ranges: EMPTY_RANGES,
};

/** Debug numbers refresh at this rate; drawing still runs every frame. */
const STATS_HZ = 10;

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`.replace(/\/{2,}/g, '/');

export interface TrackerOptions {
  /** Null renders no template — used before a wing has been designed. */
  wingParams: WingParams | null;
  /** Draws the landmark debug cloud. Tied to the metrics toggle. */
  showLandmarks: boolean;
}

export function useFaceTracker(options: TrackerOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState<TrackerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<TrackerStats>(EMPTY_STATS);
  const [frozen, setFrozen] = useState(false);

  // Options are read inside the render loop, so they live in a ref to avoid
  // tearing down and rebuilding the loop on every toggle.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const rvfcRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const lastTimestampRef = useRef(-1);
  const lastStatsAtRef = useRef(0);
  const fpsRef = useRef(new FpsMeter());
  const qualityRef = useRef(new TrackingQualityMeter());
  const gateRef = useRef(new TemplateGate());
  const rangesRef = useRef(new RangeAccumulator());
  const frozenRef = useRef(false);
  const delegateRef = useRef<'GPU' | 'CPU' | null>(null);
  const latestLandmarksRef = useRef<NormalizedPoint[] | null>(null);
  /** Last template we trust, kept so degraded tracking can hold rather than jump. */
  const lastGoodWingsRef = useRef<{ left: WingGeometry | null; right: WingGeometry | null }>({
    left: null,
    right: null,
  });

  const stop = useCallback(() => {
    runningRef.current = false;

    const video = videoRef.current;
    if (rvfcRef.current !== null && video && hasVideoFrameCallback(video)) {
      video.cancelVideoFrameCallback(rvfcRef.current);
    }
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rvfcRef.current = null;
    rafRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;

    landmarkerRef.current?.close();
    landmarkerRef.current = null;

    fpsRef.current.reset();
    qualityRef.current.reset();
    gateRef.current.reset();
    rangesRef.current.reset();
    frozenRef.current = false;
    lastTimestampRef.current = -1;
    latestLandmarksRef.current = null;
    lastGoodWingsRef.current = { left: null, right: null };

    setFrozen(false);
    setStats(EMPTY_STATS);
    setStatus('idle');
  }, []);

  const processFrame = useCallback((now: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    if (!runningRef.current || !video || !canvas || !landmarker) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // detectForVideo demands strictly increasing timestamps.
    const timestamp = Math.max(now, lastTimestampRef.current + 1);
    lastTimestampRef.current = timestamp;

    let landmarks: NormalizedPoint[] | null = null;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      const result = landmarker.detectForVideo(video, timestamp);
      landmarks = result.faceLandmarks[0] ?? null;
    }
    latestLandmarksRef.current = landmarks;

    const left = landmarks ? measureEye(landmarks, LEFT_EYE, canvas.width, canvas.height) : null;
    const right = landmarks ? measureEye(landmarks, RIGHT_EYE, canvas.width, canvas.height) : null;

    const fps = fpsRef.current.tick(now);
    const quality = qualityRef.current.update(landmarks);
    const gate = gateRef.current.update(quality, right?.angleDeg ?? null, left?.angleDeg ?? null);
    const axis = left && right ? decomposeAngles(right.angleDeg, left.angleDeg) : null;

    // Rebuild the template from ratios, but only adopt it while the gate is
    // happy. A stale template is traceable; a jumping one is not.
    const params = optionsRef.current.wingParams;
    let wings = lastGoodWingsRef.current;
    let templateFrozen = true;

    if (params && landmarks && gate.ok) {
      const rebuilt = {
        left: left ? resolveWing(landmarks, LEFT_EYE, left, params, canvas.width, canvas.height) : null,
        right: right
          ? resolveWing(landmarks, RIGHT_EYE, right, params, canvas.width, canvas.height)
          : null,
      };
      if (rebuilt.left || rebuilt.right) {
        lastGoodWingsRef.current = rebuilt;
        wings = rebuilt;
        templateFrozen = false;
      }
    }
    if (!params) {
      wings = { left: null, right: null };
      templateFrozen = false;
    }

    drawOverlay(ctx, {
      landmarks,
      metrics: { left, right },
      wings,
      showLandmarks: optionsRef.current.showLandmarks,
      templateFrozen,
    });

    if (frozenRef.current) return;

    const acc = rangesRef.current;
    acc.countSample();
    if (fps > 0) acc.observe('fps', fps);
    acc.observe('score', quality.score);
    acc.observe('inFrame', quality.inFrameRatio);
    acc.observe('stability', quality.stability);
    acc.observe('disagreement', gate.disagreementDeg);
    acc.observe('disagreementVolatility', gate.disagreementVolatilityDeg);
    if (left) {
      acc.observe('leftWidth', left.widthPx);
      acc.observe('leftHeight', left.heightPx);
      acc.observe('leftAngle', left.angleDeg);
    }
    if (right) {
      acc.observe('rightWidth', right.widthPx);
      acc.observe('rightHeight', right.heightPx);
      acc.observe('rightAngle', right.angleDeg);
    }
    if (axis) {
      acc.observe('canthalTilt', axis.canthalTiltDeg);
      acc.observe('headRoll', axis.headRollDeg);
    }

    if (now - lastStatsAtRef.current >= 1000 / STATS_HZ) {
      lastStatsAtRef.current = now;
      setStats({
        fps,
        quality,
        gate,
        left,
        right,
        landmarkCount: landmarks?.length ?? 0,
        frameSize: { width: canvas.width, height: canvas.height },
        delegate: delegateRef.current,
        canthalTiltDeg: axis?.canthalTiltDeg ?? null,
        headRollDeg: axis?.headRollDeg ?? null,
        templateFrozen: Boolean(params) && templateFrozen,
        ranges: acc.snapshot(),
      });
    }
  }, []);

  const scheduleFrame = useCallback(() => {
    const video = videoRef.current;

    // requestVideoFrameCallback fires once per decoded frame, so we never run
    // inference twice on the same image the way a bare rAF loop would.
    if (video && hasVideoFrameCallback(video)) {
      rvfcRef.current = video.requestVideoFrameCallback((now) => {
        processFrame(now);
        if (runningRef.current) scheduleFrame();
      });
      return;
    }
    rafRef.current = requestAnimationFrame((now) => {
      processFrame(now);
      if (runningRef.current) scheduleFrame();
    });
  }, [processFrame]);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    setStatus('starting');
    setError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'getUserMedia is unavailable. This needs a secure context — use localhost or https.',
        );
      }

      const [stream, landmarker] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        }),
        createLandmarker(delegateRef),
      ]);

      streamRef.current = stream;
      landmarkerRef.current = landmarker;

      const video = videoRef.current;
      if (!video) throw new Error('Video element was not mounted.');
      video.srcObject = stream;
      await video.play();
      await waitForDimensions(video);

      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Canvas element was not mounted.');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      runningRef.current = true;
      setStatus('running');
      scheduleFrame();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(describeStartFailure(message));
      setStatus('error');
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    }
  }, [scheduleFrame]);

  const resetRanges = useCallback(() => {
    rangesRef.current.reset();
    frozenRef.current = false;
    setFrozen(false);
    setStats((prev) => ({ ...prev, ranges: EMPTY_RANGES }));
  }, []);

  const toggleFreeze = useCallback(() => {
    frozenRef.current = !frozenRef.current;
    setFrozen(frozenRef.current);
  }, []);

  /**
   * Grab a still for the designer: the current video frame, already mirrored
   * so it matches the preview and so landmark canvas coordinates land on it
   * directly, plus the landmarks that go with it.
   */
  const captureStill = useCallback((): StillFrame | null => {
    const video = videoRef.current;
    const landmarks = latestLandmarksRef.current;
    if (!video || !landmarks || video.videoWidth === 0) return null;

    const width = video.videoWidth;
    const height = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, width, height);

    return { canvas, landmarks, width, height };
  }, []);

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

async function createLandmarker(
  delegateRef: { current: 'GPU' | 'CPU' | null },
): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(asset('mediapipe/wasm'));
  const options = {
    baseOptions: { modelAssetPath: asset('mediapipe/face_landmarker.task') },
    runningMode: 'VIDEO' as const,
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  };

  try {
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'GPU' as const },
    });
    delegateRef.current = 'GPU';
    return landmarker;
  } catch {
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'CPU' as const },
    });
    delegateRef.current = 'CPU';
    return landmarker;
  }
}

function waitForDimensions(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
  });
}

function describeStartFailure(message: string): string {
  if (/permission|denied|NotAllowed/i.test(message)) {
    return 'Camera permission was denied. Allow access in the browser, then press Start again.';
  }
  if (/NotFound|no.*device/i.test(message)) {
    return 'No camera was found on this device.';
  }
  if (/NotReadable|in use|busy/i.test(message)) {
    return 'The camera is busy — another app or tab probably holds it.';
  }
  return message;
}
