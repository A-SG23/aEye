/**
 * The wing designer.
 *
 * Works on a frozen frame — you cannot shape a wing against a moving eye —
 * zoomed to the subject's right eye. Only that eye is designed; the other
 * wing comes from applying the identical ratios to its own local frame.
 *
 * Handles are DOM buttons rather than canvas hit-targets, so focus rings,
 * tab order and arrow-key nudging all come for free.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RIGHT_EYE, measureEye } from '../landmarks.ts';
import {
  canvasToLocal,
  clampParams,
  curvatureFromPoint,
  eyeFrame,
  resolveWing,
  type LocalPoint,
  type WingParams,
} from '../wing.ts';
import { COLORS, traceWing } from '../draw.ts';
import type { StillFrame } from '../useFaceTracker.ts';

/** Logical design space. Handles are positioned as percentages of it. */
const VIEW_W = 100;
const VIEW_H = 62.5;

/** How much of the frame around the eye to show, in eye widths. */
const CROP_EYE_WIDTHS = 2.3;

/**
 * The view is biased outward and up from the eye centre, because that is where
 * the wing lives — centring on the eye alone wastes half the frame on the nose
 * side. Expressed in the eye's own frame so it holds at any head angle.
 */
const CROP_BIAS_ALONG = 0.3;
const CROP_BIAS_UP = 0.12;

type HandleId = 'tip' | 'upperControl' | 'lowerControl';

const HANDLE_LABELS: Record<HandleId, string> = {
  tip: 'Wing tip — length and angle',
  upperControl: 'Upper edge curve',
  lowerControl: 'Lower edge curve',
};

export interface WingDesignerProps {
  still: StillFrame;
  initialParams: WingParams;
  onConfirm: (params: WingParams) => void;
  onCancel: () => void;
  onRetake: () => void;
}

export function WingDesigner({
  still,
  initialParams,
  onConfirm,
  onCancel,
  onRetake,
}: WingDesignerProps) {
  const [params, setParams] = useState<WingParams>(initialParams);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<HandleId | null>(null);

  const eye = useMemo(
    () => measureEye(still.landmarks, RIGHT_EYE, still.width, still.height),
    [still],
  );

  const frame = useMemo(() => (eye ? eyeFrame(eye) : null), [eye]);

  // Crop the still down to the eye, then map that crop onto the design space.
  const view = useMemo(() => {
    if (!eye || !frame) return null;
    const cx = (eye.outer.x + eye.inner.x) / 2;
    const cy = (eye.upper.y + eye.lower.y) / 2;
    const w = eye.widthPx;
    const centreX = cx + (frame.u.x * CROP_BIAS_ALONG + frame.v.x * CROP_BIAS_UP) * w;
    const centreY = cy + (frame.u.y * CROP_BIAS_ALONG + frame.v.y * CROP_BIAS_UP) * w;

    const cropW = w * CROP_EYE_WIDTHS;
    const cropH = (cropW * VIEW_H) / VIEW_W;
    const cropX = centreX - cropW / 2;
    const cropY = centreY - cropH / 2;
    return {
      cropX,
      cropY,
      cropW,
      cropH,
      toView: (p: { x: number; y: number }) => ({
        x: ((p.x - cropX) / cropW) * VIEW_W,
        y: ((p.y - cropY) / cropH) * VIEW_H,
      }),
      fromView: (p: { x: number; y: number }) => ({
        x: (p.x / VIEW_W) * cropW + cropX,
        y: (p.y / VIEW_H) * cropH + cropY,
      }),
    };
  }, [eye, frame]);

  const wing = useMemo(
    () =>
      eye ? resolveWing(still.landmarks, RIGHT_EYE, eye, params, still.width, still.height) : null,
    [eye, still, params],
  );

  // --- render ---------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || !wing) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pxW = Math.round(VIEW_W * 8 * dpr);
    const pxH = Math.round(VIEW_H * 8 * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pxW, pxH);

    // Map still-canvas pixels straight into the backing store.
    const sx = pxW / view.cropW;
    const sy = pxH / view.cropH;
    ctx.drawImage(
      still.canvas,
      view.cropX,
      view.cropY,
      view.cropW,
      view.cropH,
      0,
      0,
      pxW,
      pxH,
    );

    ctx.save();
    ctx.scale(sx, sy);
    ctx.translate(-view.cropX, -view.cropY);

    traceWing(ctx, wing);
    ctx.fillStyle = COLORS.templateFill;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.templateEdge;
    ctx.lineWidth = 3.5 / sx;
    ctx.stroke();
    ctx.strokeStyle = COLORS.template;
    ctx.lineWidth = 2 / sx;
    ctx.stroke();

    // Control arms, so the handles read as attached to the curve.
    ctx.strokeStyle = 'rgba(140, 94, 136, 0.65)';
    ctx.lineWidth = 1.2 / sx;
    ctx.setLineDash([4 / sx, 3 / sx]);
    for (const [from, to] of [
      [wing.upperAnchor, wing.upperControl],
      [wing.upperControl, wing.tip],
      [wing.lowerAnchor, wing.lowerControl],
      [wing.lowerControl, wing.tip],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Landmark-locked anchors, drawn but not grabbable.
    for (const anchor of [wing.upperAnchor, wing.lowerAnchor]) {
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, 3.5 / sx, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.template;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / sx;
      ctx.stroke();
    }

    ctx.restore();
  }, [view, wing, still]);

  // --- handle positions -----------------------------------------------------
  const handles = useMemo(() => {
    if (!wing || !view) return null;
    return {
      tip: view.toView(wing.tip),
      upperControl: view.toView(wing.upperControl),
      lowerControl: view.toView(wing.lowerControl),
    };
  }, [wing, view]);

  /** Turn a point in design space into updated params for the active handle. */
  const applyHandle = useCallback(
    (id: HandleId, viewPoint: { x: number; y: number }) => {
      if (!view || !frame || !wing) return;
      const stillPoint = view.fromView(viewPoint);
      const local = canvasToLocal(frame, stillPoint);

      setParams((prev) => {
        if (id === 'tip') {
          const length = Math.hypot(local.a, local.b);
          const angle = (Math.atan2(local.b, local.a) * 180) / Math.PI;
          return clampParams({ ...prev, tipLength: length, tipAngleDeg: angle });
        }

        const radians = (prev.tipAngleDeg * Math.PI) / 180;
        const tipLocal: LocalPoint = {
          a: prev.tipLength * Math.cos(radians),
          b: prev.tipLength * Math.sin(radians),
        };
        if (id === 'upperControl') {
          const anchor = canvasToLocal(frame, wing.upperAnchor);
          return clampParams({
            ...prev,
            upperCurvature: curvatureFromPoint(anchor, tipLocal, local),
          });
        }
        return clampParams({
          ...prev,
          lowerCurvature: curvatureFromPoint({ a: 0, b: 0 }, tipLocal, local),
        });
      });
    },
    [view, frame, wing],
  );

  const pointToView = useCallback((clientX: number, clientY: number) => {
    const surface = surfaceRef.current;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * VIEW_W,
      y: ((clientY - rect.top) / rect.height) * VIEW_H,
    };
  }, []);

  const onPointerDown = (id: HandleId) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = id;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const p = pointToView(e.clientX, e.clientY);
    if (p) applyHandle(dragRef.current, p);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const target = e.target as HTMLElement;
    if (target.hasPointerCapture?.(e.pointerId)) target.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  /** Arrow keys nudge a focused handle by a small step in design space. */
  const onHandleKeyDown = (id: HandleId) => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 2 : 0.5;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = deltas[e.key];
    if (!delta || !handles) return;
    e.preventDefault();
    applyHandle(id, { x: handles[id].x + delta[0], y: handles[id].y + delta[1] });
  };

  // Escape closes; the modal is the only interactive surface while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const unusable = !eye || !view || !wing || !handles;

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Set wing shape"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Set wing shape</h2>
          <p className="modal-sub">
            Shaping your right eye. The other wing mirrors automatically.
          </p>
        </header>

        {unusable ? (
          <div className="designer-empty">
            <p>That frame did not have a clear enough eye to shape against.</p>
            <button className="btn" onClick={onRetake}>
              Retake frame
            </button>
          </div>
        ) : (
          <div
            className="designer-surface"
            ref={surfaceRef}
            style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <canvas ref={canvasRef} className="designer-canvas" />
            {(Object.keys(HANDLE_LABELS) as HandleId[]).map((id) => (
              <button
                key={id}
                type="button"
                className={`handle handle-${id}`}
                aria-label={HANDLE_LABELS[id]}
                style={{
                  left: `${(handles[id].x / VIEW_W) * 100}%`,
                  top: `${(handles[id].y / VIEW_H) * 100}%`,
                }}
                onPointerDown={onPointerDown(id)}
                onKeyDown={onHandleKeyDown(id)}
              />
            ))}
          </div>
        )}

        <p className="designer-hint">
          Drag the three handles, or focus one and nudge with the arrow keys. Hold shift for
          bigger steps. The two green dots sit on your lash line and are not draggable.
        </p>

        <footer className="modal-foot">
          <button className="btn btn-quiet" onClick={onRetake}>
            Retake frame
          </button>
          <div className="modal-foot-right">
            <button className="btn btn-quiet" onClick={onCancel}>
              Cancel
            </button>
            <button className="btn btn-go" onClick={() => onConfirm(params)} disabled={unusable}>
              draw!
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
