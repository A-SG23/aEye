import { LEFT_EYE, RIGHT_EYE, type EyeMetrics } from './landmarks';
import { useFaceTracker } from './useFaceTracker';
import type { TrackerStats } from './useFaceTracker';
import './App.css';

export default function App() {
  const { videoRef, canvasRef, status, error, stats, start, stop } = useFaceTracker();

  return (
    <main className="app">
      <header className="bar">
        <h1>aEye — M0</h1>
        <div className="controls">
          {status === 'running' ? (
            <button onClick={stop}>Stop</button>
          ) : (
            <button onClick={start} disabled={status === 'starting'}>
              {status === 'starting' ? 'Starting…' : 'Start camera'}
            </button>
          )}
          <span className={`status status-${status}`}>{status}</span>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="stage">
        {/* Mirrored for a selfie view. Landmark x is flipped to match in toCanvas(). */}
        <video ref={videoRef} className="mirrored" playsInline muted />
        <canvas ref={canvasRef} className="overlay" />
        {status === 'idle' && !error && (
          <p className="hint">Press Start camera. Video never leaves this device.</p>
        )}
      </div>

      <DebugReadout stats={stats} />
    </main>
  );
}

function DebugReadout({ stats }: { stats: TrackerStats }) {
  const { quality } = stats;

  return (
    <section className="debug">
      <div className="panel">
        <h2>Frame</h2>
        <Row label="FPS" value={stats.fps.toFixed(1)} />
        <Row
          label="Resolution"
          value={
            stats.frameSize.width
              ? `${stats.frameSize.width}×${stats.frameSize.height}`
              : '—'
          }
        />
        <Row label="Delegate" value={stats.delegate ?? '—'} />
        <Row label="Landmarks" value={stats.landmarkCount || '—'} />
      </div>

      <div className="panel">
        <h2>
          Tracking confidence <span className="tag">derived</span>
        </h2>
        <Meter value={quality.score} />
        <Row label="Score" value={quality.score.toFixed(2)} />
        <Row label="Face present" value={quality.present ? 'yes' : 'no'} />
        <Row label="Detection rate" value={quality.detectionRate.toFixed(2)} />
        <Row label="In-frame" value={quality.inFrameRatio.toFixed(2)} />
        <Row label="Stability" value={quality.stability.toFixed(2)} />
        <p className="note">
          MediaPipe does not expose a confidence score, so this is a proxy built from
          detection rate, how much of the mesh is inside the frame, and frame-to-frame
          jitter.
        </p>
      </div>

      {/* Ordered to match the mirrored preview: screen-left panel = screen-left eye. */}
      <EyePanel
        title="Left eye (subject) — left on screen"
        indices={LEFT_EYE}
        metrics={stats.left}
      />
      <EyePanel
        title="Right eye (subject) — right on screen"
        indices={RIGHT_EYE}
        metrics={stats.right}
      />
    </section>
  );
}

function EyePanel({
  title,
  indices,
  metrics,
}: {
  title: string;
  indices: typeof LEFT_EYE;
  metrics: EyeMetrics | null;
}) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      <Row label="Width" value={metrics ? `${metrics.widthPx.toFixed(1)} px` : '—'} />
      <Row label="Height" value={metrics ? `${metrics.heightPx.toFixed(1)} px` : '—'} />
      <Row label="Axis angle" value={metrics ? `${metrics.angleDeg.toFixed(1)}°` : '—'} />
      <Row label="H/W ratio" value={metrics ? metrics.aspectRatio.toFixed(3) : '—'} />
      <div className="indices">
        <span>outer {indices.outerCanthus}</span>
        <span>inner {indices.innerCanthus}</span>
        <span>upper {indices.upperLid}</span>
        <span>lower {indices.lowerLid}</span>
      </div>
      <p className="note">Positive angle = outer corner above inner corner.</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="row">
      <span>{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

function Meter({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const hue = Math.round(value * 120); // red -> green
  return (
    <div className="meter" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct}%`, background: `hsl(${hue} 80% 50%)` }} />
    </div>
  );
}
