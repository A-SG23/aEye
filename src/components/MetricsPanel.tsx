/**
 * Every numeric readout, behind the single Metrics toggle. Off by default.
 *
 * This is the diagnostic surface: when the template lands wrong, these are the
 * numbers that say why.
 */
import { LEFT_EYE, RIGHT_EYE, type EyeMetrics } from '../landmarks.ts';
import type { TrackerStats } from '../useFaceTracker.ts';
import type { MetricRange, RangeSnapshot } from '../trackingQuality.ts';
import type { WingParams } from '../wing.ts';

export function MetricsPanel({
  stats,
  wingParams,
  frozen,
  onResetRanges,
  onToggleFreeze,
}: {
  stats: TrackerStats;
  wingParams: WingParams | null;
  frozen: boolean;
  onResetRanges: () => void;
  onToggleFreeze: () => void;
}) {
  const { quality, gate, ranges } = stats;

  return (
    <aside className="metrics">
      <div className="metrics-bar">
        <span className="metrics-title">Metrics</span>
        <div className="metrics-actions">
          <button className="btn btn-tiny" onClick={onResetRanges}>
            Reset (R)
          </button>
          <button className={`btn btn-tiny ${frozen ? 'btn-on' : ''}`} onClick={onToggleFreeze}>
            {frozen ? 'Frozen' : 'Freeze'} (space)
          </button>
        </div>
      </div>

      <div className="metrics-grid">
        <Panel title="Frame">
          <Row label="FPS" value={stats.fps.toFixed(1)} range={ranges.ranges.fps} digits={1} />
          <Row
            label="Resolution"
            value={stats.frameSize.width ? `${stats.frameSize.width}×${stats.frameSize.height}` : '—'}
          />
          <Row label="Delegate" value={stats.delegate ?? '—'} />
          <Row label="Landmarks" value={stats.landmarkCount || '—'} />
          <Row label="Captured frames" value={ranges.samples || '—'} />
        </Panel>

        <Panel title="Tracking confidence" tag="derived">
          <Meter value={quality.score} />
          <Row label="Score" value={quality.score.toFixed(2)} range={ranges.ranges.score} />
          <Row label="Face present" value={quality.present ? 'yes' : 'no'} />
          <Row label="Detection rate" value={quality.detectionRate.toFixed(2)} />
          <Row label="In-frame" value={quality.inFrameRatio.toFixed(2)} range={ranges.ranges.inFrame} />
          <Row label="Stability" value={quality.stability.toFixed(2)} range={ranges.ranges.stability} />
          <p className="note">
            MediaPipe exposes no confidence score, so this is a proxy built from detection rate,
            how much of the mesh is inside the frame, and frame-to-frame jitter.
          </p>
        </Panel>

        <Panel title="Face axis" tag="derived">
          <Row
            label="Canthal tilt"
            value={fmtDeg(stats.canthalTiltDeg)}
            range={ranges.ranges.canthalTilt}
            digits={1}
            suffix="°"
          />
          <Row
            label="Head roll"
            value={fmtDeg(stats.headRollDeg)}
            range={ranges.ranges.headRoll}
            digits={1}
            suffix="°"
          />
          <p className="note">
            A head roll moves the two eye angles in opposite directions; a real canthal tilt moves
            them the same way. So their mean is the tilt and half their difference is the roll.
          </p>
        </Panel>

        <Panel title="Template gate" tag={stats.templateFrozen ? 'held' : 'live'}>
          <Row label="State" value={stats.templateFrozen ? 'holding last good' : 'tracking'} />
          <Row
            label="Eye angle split"
            value={`${gate.disagreementDeg.toFixed(1)}°`}
            range={ranges.ranges.disagreement}
            digits={1}
            suffix="°"
          />
          <Row
            label="Split volatility"
            value={`${gate.disagreementVolatilityDeg.toFixed(2)}°`}
            range={ranges.ranges.disagreementVolatility}
            suffix="°"
          />
          <Row label="Failing" value={gate.reasons.length ? gate.reasons.join(', ') : 'none'} />
          <p className="note">
            The raw split is arithmetically twice the head roll, so tilting your head would trip a
            threshold on its magnitude. The gate watches how much the split is <em>moving</em>{' '}
            instead.
          </p>
        </Panel>

        <Panel title="Wing parameters" tag="stored">
          {wingParams ? (
            <>
              <Row label="Tip length" value={`${wingParams.tipLength.toFixed(3)} × W`} />
              <Row label="Tip angle" value={`${wingParams.tipAngleDeg.toFixed(1)}° off axis`} />
              <Row label="Upper curve" value={wingParams.upperCurvature.toFixed(3)} />
              <Row label="Lower curve" value={wingParams.lowerCurvature.toFixed(3)} />
              <Row label="Upper anchor" value={wingParams.upperAnchorRatio.toFixed(3)} />
            </>
          ) : (
            <p className="note">No wing set yet.</p>
          )}
          <p className="note">
            All dimensionless. Rebuilt against the current frame's landmarks every frame, which is
            what makes the template survive head tilt and camera distance.
          </p>
        </Panel>

        <EyePanel title="Left eye — left on screen" indices={LEFT_EYE} metrics={stats.left} ranges={ranges} prefix="left" />
        <EyePanel title="Right eye — right on screen" indices={RIGHT_EYE} metrics={stats.right} ranges={ranges} prefix="right" />
      </div>
    </aside>
  );
}

function fmtDeg(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}°`;
}

function Panel({
  title,
  tag,
  children,
}: {
  title: string;
  tag?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel">
      <h3>
        {title}
        {tag && <span className="tag">{tag}</span>}
      </h3>
      {children}
    </div>
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
    <Panel title={title}>
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
    </Panel>
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
  return (
    <div className="meter" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}
