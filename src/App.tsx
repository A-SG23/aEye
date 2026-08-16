import { useEffect } from 'react';
import { LEFT_EYE, RIGHT_EYE, type EyeMetrics } from './landmarks';
import { useFaceTracker } from './useFaceTracker';
import type { TrackerStats } from './useFaceTracker';
import type { MetricRange, RangeSnapshot } from './trackingQuality';
import './App.css';

export default function App() {
  const { videoRef, canvasRef, status, error, stats, frozen, start, stop, resetRanges, toggleFreeze } =
    useFaceTracker();

  // Keyboard control: at application distance you cannot see the buttons.
  useEffect(() => {
    if (status !== 'running') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggleFreeze();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        resetRanges();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, toggleFreeze, resetRanges]);

  return (
    <main className="app">
      <header className="bar">
        <h1>aEye — M0</h1>
        <div className="controls">
          {status === 'running' && (
            <>
              <button onClick={resetRanges}>Reset ranges (R)</button>
              <button onClick={toggleFreeze} className={frozen ? 'active' : ''}>
                {frozen ? 'Frozen — resume (space)' : 'Freeze (space)'}
              </button>
            </>
          )}
          {status === 'running' ? (
            <button onClick={stop}>Stop</button>
          ) : (
            <button onClick={start} disabled={status === 'starting'}>
              {status === 'starting' ? 'Starting…' : 'Start camera'}
            </button>
          )}
          <span className={`status status-${status}`}>{frozen ? 'frozen' : status}</span>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {status === 'running' && (
        <p className="protocol">
          Press <kbd>R</kbd> to reset, lean in and hold, sit back, then <kbd>space</kbd> to freeze
          and read the min–max under each value. Capture runs at full frame rate, so a brief dip
          still registers.
        </p>
      )}

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
  const { quality, ranges } = stats;

  return (
    <section className="debug">
      <div className="panel">
        <h2>Frame</h2>
        <Row label="FPS" value={stats.fps.toFixed(1)} range={ranges.ranges.fps} digits={1} />
        <Row
          label="Resolution"
          value={stats.frameSize.width ? `${stats.frameSize.width}×${stats.frameSize.height}` : '—'}
        />
        <Row label="Delegate" value={stats.delegate ?? '—'} />
        <Row label="Landmarks" value={stats.landmarkCount || '—'} />
        <Row label="Captured frames" value={ranges.samples || '—'} />
      </div>

      <div className="panel">
        <h2>
          Tracking confidence <span className="tag">derived</span>
        </h2>
        <Meter value={quality.score} />
        <Row label="Score" value={quality.score.toFixed(2)} range={ranges.ranges.score} />
        <Row label="Face present" value={quality.present ? 'yes' : 'no'} />
        <Row label="Detection rate" value={quality.detectionRate.toFixed(2)} />
        <Row
          label="In-frame"
          value={quality.inFrameRatio.toFixed(2)}
          range={ranges.ranges.inFrame}
        />
        <Row
          label="Stability"
          value={quality.stability.toFixed(2)}
          range={ranges.ranges.stability}
        />
        <p className="note">
          MediaPipe does not expose a confidence score, so this is a proxy built from detection
          rate, how much of the mesh is inside the frame, and frame-to-frame jitter.
        </p>
      </div>

      <div className="panel">
        <h2>
          Face axis <span className="tag">derived</span>
        </h2>
        <Row
          label="Canthal tilt"
          value={stats.canthalTiltDeg === null ? '—' : `${stats.canthalTiltDeg.toFixed(1)}°`}
          range={ranges.ranges.canthalTilt}
          digits={1}
          suffix="°"
        />
        <Row
          label="Head roll"
          value={stats.headRollDeg === null ? '—' : `${stats.headRollDeg.toFixed(1)}°`}
          range={ranges.ranges.headRoll}
          digits={1}
          suffix="°"
        />
        <p className="note">
          A head roll moves the two eye angles in opposite directions; a real canthal tilt moves
          them the same way. So their mean is the tilt and half their difference is the roll.
        </p>
      </div>

      {/* Ordered to match the mirrored preview: screen-left panel = screen-left eye. */}
      <EyePanel
        title="Left eye (subject) — left on screen"
        indices={LEFT_EYE}
        metrics={stats.left}
        ranges={ranges}
        prefix="left"
      />
      <EyePanel
        title="Right eye (subject) — right on screen"
        indices={RIGHT_EYE}
        metrics={stats.right}
        ranges={ranges}
        prefix="right"
      />
    </section>
  );
}

function EyePanel({
  title,
  indices,
  metrics,
  ranges,
  prefix,
}: {
  title: string;
  indices: typeof LEFT_EYE;
  metrics: EyeMetrics | null;
  ranges: RangeSnapshot;
  prefix: 'left' | 'right';
}) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      <Row
        label="Width"
        value={metrics ? `${metrics.widthPx.toFixed(1)} px` : '—'}
        range={ranges.ranges[`${prefix}Width`]}
        digits={1}
        suffix=" px"
      />
      <Row
        label="Height"
        value={metrics ? `${metrics.heightPx.toFixed(1)} px` : '—'}
        range={ranges.ranges[`${prefix}Height`]}
        digits={1}
        suffix=" px"
      />
      <Row
        label="Axis angle"
        value={metrics ? `${metrics.angleDeg.toFixed(1)}°` : '—'}
        range={ranges.ranges[`${prefix}Angle`]}
        digits={1}
        suffix="°"
      />
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

function Row({
  label,
  value,
  range,
  digits = 2,
  suffix = '',
}: {
  label: string;
  value: string | number;
  range?: MetricRange;
  digits?: number;
  suffix?: string;
}) {
  return (
    <div className="row">
      <span>{label}</span>
      <span className="value">
        {value}
        {range && (
          <em className="range">
            {range.min.toFixed(digits)}
            {suffix} … {range.max.toFixed(digits)}
            {suffix}
          </em>
        )}
      </span>
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
