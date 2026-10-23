/**
 * Preset starting points, drawn as little SVG thumbnails.
 *
 * The thumbnails use the real Bézier maths against a synthetic level eye, so
 * what you see is the shape you get — not a hand-drawn approximation that
 * could drift away from what the preset actually does.
 */
import { WING_PRESETS, previewGeometry, type WingParams, type WingPreset } from '../../core/wing.ts';

/** Thumbnail viewbox, in eye-width units, with the outer canthus at the origin. */
const VB = { x: -0.95, y: -0.45, w: 1.65, h: 0.95 };

function Thumb({ params }: { params: WingParams }) {
  const g = previewGeometry(params);
  // Local +b is up; SVG y grows down, so b is negated on the way out.
  const pt = (p: { a: number; b: number }) => `${p.a.toFixed(4)},${(-p.b).toFixed(4)}`;
  const wing = [
    `M ${pt(g.upperAnchor)}`,
    `Q ${pt(g.upperControl)} ${pt(g.tip)}`,
    `Q ${pt(g.lowerControl)} ${pt(g.lowerAnchor)}`,
    `L ${pt(g.upperAnchor)}`,
    'Z',
  ].join(' ');

  return (
    <svg
      className="preset-thumb"
      viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
      role="presentation"
      focusable="false"
    >
      {/* A stylised eye for context: lid above, lash line below. */}
      <path
        d="M -0.92,0 Q -0.5,-0.3 0,0 Q -0.5,0.2 -0.92,0 Z"
        fill="#ffffff"
        stroke="#bbbbbb"
        strokeWidth="0.015"
      />
      <circle cx="-0.46" cy="-0.015" r="0.1" fill="#74862d" />
      <circle cx="-0.46" cy="-0.015" r="0.045" fill="#0c3a24" />
      <path d="M -0.92,0 Q -0.5,-0.3 0,0" fill="none" stroke="#111111" strokeWidth="0.045" />
      <path d={wing} fill="rgba(116,134,45,0.3)" stroke="#95b300" strokeWidth="0.03" strokeLinejoin="round" />
    </svg>
  );
}

export function WingPresets({
  active,
  onPick,
}: {
  active: string | null;
  onPick: (preset: WingPreset) => void;
}) {
  return (
    <div className="presets">
      <p className="presets-label">Start from an idea, or just drag the handles yourself.</p>
      <div className="presets-row">
        {WING_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`preset ${active === preset.id ? 'is-active' : ''}`}
            aria-pressed={active === preset.id}
            onClick={() => onPick(preset)}
          >
            <Thumb params={preset.params} />
            <span className="preset-name">{preset.name}</span>
            <span className="preset-blurb">{preset.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
