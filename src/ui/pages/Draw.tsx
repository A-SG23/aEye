/**
 * The camera page: live guide, the designer entry point, and the metrics
 * toggle. The camera frame takes the whole content area; metrics open in a
 * panel beneath it rather than over it.
 */
import { useCallback, useEffect, useState } from 'react';
import { useFaceTracker, type StillFrame } from '../hooks/useFaceTracker.ts';
import { DEFAULT_WING, type WingParams } from '../../core/wing.ts';
import { MetricsPanel } from '../components/MetricsPanel.tsx';
import { WingDesigner } from '../components/WingDesigner.tsx';

export function Draw({
  wingParams,
  onWingParams,
}: {
  wingParams: WingParams | null;
  onWingParams: (p: WingParams) => void;
}) {
  const [showMetrics, setShowMetrics] = useState(false);
  const [still, setStill] = useState<StillFrame | null>(null);
  const [captureFailed, setCaptureFailed] = useState(false);

  const { videoRef, canvasRef, status, error, stats, frozen, start, stop, resetRanges, toggleFreeze, captureStill } =
    useFaceTracker({ wingParams, showLandmarks: showMetrics });

  const openDesigner = useCallback(() => {
    const frame = captureStill();
    if (!frame) {
      setCaptureFailed(true);
      return;
    }
    setCaptureFailed(false);
    setStill(frame);
  }, [captureStill]);

  // Metrics shortcuts only while the designer is closed — it owns the keyboard.
  useEffect(() => {
    if (status !== 'running' || still) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
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
  }, [status, still, toggleFreeze, resetRanges]);

  const running = status === 'running';

  return (
    <div className="draw">
      <div className="draw-bar">
        <div className="draw-bar-left">
          {running ? (
            <button className="btn btn-quiet" onClick={stop}>
              Stop camera
            </button>
          ) : (
            <button className="btn btn-primary" onClick={start} disabled={status === 'starting'}>
              {status === 'starting' ? 'Starting…' : 'Start camera'}
            </button>
          )}
          {running && wingParams && (
            <button className="btn btn-primary" onClick={openDesigner}>
              Change wing shape
            </button>
          )}
        </div>
        <div className="draw-bar-right">
          {running && stats.templateFrozen && wingParams && (
            <span className="held" title={stats.gate.reasons.join(', ')}>
              template held
            </span>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={showMetrics}
              onChange={(e) => setShowMetrics(e.target.checked)}
            />
            <span>Metrics</span>
          </label>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {captureFailed && (
        <p className="error">
          Could not grab a frame — no face was being tracked. Look at the camera and try again.
        </p>
      )}

      <div className="stage">
        {/* Mirrored so hand movement matches what you see. */}
        <video ref={videoRef} className="mirrored" playsInline muted />
        <canvas ref={canvasRef} className="overlay" />
        {!running && !error && (
          <p className="stage-hint">
            {status === 'starting' ? 'Starting camera…' : 'Start the camera to begin.'}
            <br />
            <span className="muted-line">Video never leaves this device.</span>
          </p>
        )}

        {/* First run has nothing to look at yet, so point at the next step. */}
        {running && !wingParams && (
          <div className="stage-cta">
            <button className="btn btn-primary btn-lg stage-cta-btn" onClick={openDesigner}>
              Set wing shape!
            </button>
            <p className="stage-cta-note">
              stay still with your eyes open for 2 seconds, then click draw!
            </p>
          </div>
        )}

        {running && <p className="stage-smile">Smile!</p>}
      </div>

      {showMetrics && (
        <MetricsPanel
          stats={stats}
          wingParams={wingParams}
          frozen={frozen}
          onResetRanges={resetRanges}
          onToggleFreeze={toggleFreeze}
        />
      )}

      {still && (
        <WingDesigner
          still={still}
          initialParams={wingParams ?? DEFAULT_WING}
          onCancel={() => setStill(null)}
          onRetake={openDesigner}
          onConfirm={(p) => {
            onWingParams(p);
            setStill(null);
          }}
        />
      )}
    </div>
  );
}
