/**
 * Owns the webcam stream, the Face Landmarker, and the per-frame loop.
 *
 * Everything here is client-side: the MediaStream goes straight into a <video>,
 * frames are handed to the wasm runtime in-process, and nothing is uploaded.
 *
 * Framework-free: state changes are reported through FaceTrackerEvents, so a
 * UI layer (see ui/hooks/useFaceTracker.ts) only has to mirror them.
 */
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
import { LandmarkSmoother } from './smoothing.ts';
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

export const EMPTY_STATS: TrackerStats = {
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

/**
 * Where the tracker finds its elements. Getters rather than elements, so the
 * loop always reads whatever is mounted right now.
 */
export interface TrackerElements {
  video: () => HTMLVideoElement | null;
  canvas: () => HTMLCanvasElement | null;
}

export interface FaceTrackerEvents {
  onStatus: (status: TrackerStatus) => void;
  onError: (error: string | null) => void;
  onStats: (stats: TrackerStats) => void;
  onFrozen: (frozen: boolean) => void;
}

export class FaceTracker {
  /** Read inside the render loop, so changing it never restarts the loop. */
  options: TrackerOptions = { wingParams: null, showLandmarks: false };

  private readonly elements: TrackerElements;
  private readonly events: FaceTrackerEvents;

  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private raf: number | null = null;
  private rvfc: number | null = null;
  private running = false;
  private lastTimestamp = -1;
  private lastStatsAt = 0;
  private readonly fps = new FpsMeter();
  private readonly quality = new TrackingQualityMeter();
  private readonly gate = new TemplateGate();
  private readonly ranges = new RangeAccumulator();
  private readonly smoother = new LandmarkSmoother();
  private frozen = false;
  private delegate: 'GPU' | 'CPU' | null = null;
  private latestLandmarks: NormalizedPoint[] | null = null;
  private stats: TrackerStats = EMPTY_STATS;
  /** Last template we trust, kept so degraded tracking can hold rather than jump. */
  private lastGoodWings: { left: WingGeometry | null; right: WingGeometry | null } = {
    left: null,
    right: null,
  };

  constructor(elements: TrackerElements, events: FaceTrackerEvents) {
    this.elements = elements;
    this.events = events;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.events.onStatus('starting');
    this.events.onError(null);

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
        createLandmarker((d) => (this.delegate = d)),
      ]);

      this.stream = stream;
      this.landmarker = landmarker;

      const video = this.elements.video();
      if (!video) throw new Error('Video element was not mounted.');
      video.srcObject = stream;
      await video.play();
      await waitForDimensions(video);

      const canvas = this.elements.canvas();
      if (!canvas) throw new Error('Canvas element was not mounted.');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      this.running = true;
      this.events.onStatus('running');
      this.scheduleFrame();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.events.onError(describeStartFailure(message));
      this.events.onStatus('error');
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.landmarker?.close();
      this.landmarker = null;
    }
  }

  stop(): void {
    this.running = false;

    const video = this.elements.video();
    if (this.rvfc !== null && video && hasVideoFrameCallback(video)) {
      video.cancelVideoFrameCallback(this.rvfc);
    }
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.rvfc = null;
    this.raf = null;

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (video) video.srcObject = null;

    this.landmarker?.close();
    this.landmarker = null;

    this.fps.reset();
    this.quality.reset();
    this.gate.reset();
    this.smoother.reset();
    this.ranges.reset();
    this.frozen = false;
    this.lastTimestamp = -1;
    this.latestLandmarks = null;
    this.lastGoodWings = { left: null, right: null };

    this.events.onFrozen(false);
    this.emitStats(EMPTY_STATS);
    this.events.onStatus('idle');
  }

  resetRanges(): void {
    this.ranges.reset();
    this.frozen = false;
    this.events.onFrozen(false);
    this.emitStats({ ...this.stats, ranges: EMPTY_RANGES });
  }

  toggleFreeze(): void {
    this.frozen = !this.frozen;
    this.events.onFrozen(this.frozen);
  }

  /**
   * Grab a still for the designer: the current video frame, already mirrored
   * so it matches the preview and so landmark canvas coordinates land on it
   * directly, plus the landmarks that go with it.
   */
  captureStill(): StillFrame | null {
    const video = this.elements.video();
    const landmarks = this.latestLandmarks;
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
  }

  private emitStats(stats: TrackerStats): void {
    this.stats = stats;
    this.events.onStats(stats);
  }

  private scheduleFrame(): void {
    const video = this.elements.video();

    // requestVideoFrameCallback fires once per decoded frame, so we never run
    // inference twice on the same image the way a bare rAF loop would.
    if (video && hasVideoFrameCallback(video)) {
      this.rvfc = video.requestVideoFrameCallback((now) => {
        this.processFrame(now);
        if (this.running) this.scheduleFrame();
      });
      return;
    }
    this.raf = requestAnimationFrame((now) => {
      this.processFrame(now);
      if (this.running) this.scheduleFrame();
    });
  }

  private processFrame(now: number): void {
    const video = this.elements.video();
    const canvas = this.elements.canvas();
    const landmarker = this.landmarker;
    if (!this.running || !video || !canvas || !landmarker) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // detectForVideo demands strictly increasing timestamps.
    const timestamp = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;

    let landmarks: NormalizedPoint[] | null = null;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      const result = landmarker.detectForVideo(video, timestamp);
      const raw = result.faceLandmarks[0] ?? null;
      // Smooth before anything reads the landmarks, so the metrics, the
      // template and the debug cloud all agree on one steady set of points.
      landmarks = raw ? this.smoother.smooth(raw, timestamp) : null;
      if (!raw) this.smoother.reset();
    }
    this.latestLandmarks = landmarks;

    const left = landmarks ? measureEye(landmarks, LEFT_EYE, canvas.width, canvas.height) : null;
    const right = landmarks ? measureEye(landmarks, RIGHT_EYE, canvas.width, canvas.height) : null;

    const fps = this.fps.tick(now);
    const quality = this.quality.update(landmarks);
    const gate = this.gate.update(quality, right?.angleDeg ?? null, left?.angleDeg ?? null);
    const axis = left && right ? decomposeAngles(right.angleDeg, left.angleDeg) : null;

    // Rebuild the template from ratios, but only adopt it while the gate is
    // happy. A stale template is traceable; a jumping one is not.
    const params = this.options.wingParams;
    let wings = this.lastGoodWings;
    let templateFrozen = true;

    if (params && landmarks && gate.ok) {
      const rebuilt = {
        left: left ? resolveWing(landmarks, LEFT_EYE, left, params, canvas.width, canvas.height) : null,
        right: right
          ? resolveWing(landmarks, RIGHT_EYE, right, params, canvas.width, canvas.height)
          : null,
      };
      if (rebuilt.left || rebuilt.right) {
        this.lastGoodWings = rebuilt;
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
      showLandmarks: this.options.showLandmarks,
      templateFrozen,
    });

    if (this.frozen) return;

    const acc = this.ranges;
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

    if (now - this.lastStatsAt >= 1000 / STATS_HZ) {
      this.lastStatsAt = now;
      this.emitStats({
        fps,
        quality,
        gate,
        left,
        right,
        landmarkCount: landmarks?.length ?? 0,
        frameSize: { width: canvas.width, height: canvas.height },
        delegate: this.delegate,
        canthalTiltDeg: axis?.canthalTiltDeg ?? null,
        headRollDeg: axis?.headRollDeg ?? null,
        templateFrozen: Boolean(params) && templateFrozen,
        ranges: acc.snapshot(),
      });
    }
  }
}

async function createLandmarker(
  onDelegate: (delegate: 'GPU' | 'CPU') => void,
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
    onDelegate('GPU');
    return landmarker;
  } catch {
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'CPU' as const },
    });
    onDelegate('CPU');
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
