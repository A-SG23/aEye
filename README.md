# aEye

A live camera guide that draws your eyeliner wing on your own eye, so you can
trace instead of guess.

Vite + React + TypeScript, MediaPipe Face Landmarker, Canvas 2D overlay on a
mirrored webcam feed. Everything runs client-side — the wasm runtime, the
model and the font are all served from this app's own origin, so no frames and
no requests leave the device once the page has loaded.

## Running

```bash
npm install
npm run dev      # syncs MediaPipe assets, then serves on :5173
```

`npm run dev` and `npm run build` both run `scripts/sync-mediapipe-assets.mjs`
first, which copies the wasm out of `node_modules` and downloads
`face_landmarker.task` (3.76 MB) into `public/mediapipe/`. That directory is
gitignored — it is ~40 MB of generated artifacts.

Camera access needs a secure context: `localhost` works, a bare LAN IP will not.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build |
| `npm run check` | Geometry, template and freeze-gate checks |
| `npm run logo` | Regenerate the pixel-art logo PNG |
| `npm run lint` | oxlint |

## Shell

Three hash routes behind a persistent sidebar: `home`, `draw`, `explore`.
Routing is hand-rolled in [src/router.ts](src/router.ts) — three static routes
with no params or nesting did not justify a dependency. On viewports under
720px the sidebar becomes a top bar; two nav items do not need a drawer.

`draw` owns the camera. `explore` is a placeholder.

## Theme and logo

> **The logo is a placeholder.** No logo asset was supplied, so
> [scripts/make-logo.mjs](scripts/make-logo.mjs) generates one to spec — a
> pixel-art eye with a green iris and black liner — as a real 21×13 PNG. To
> swap in the real one, drop it at `public/aeye-logo.png` and delete that
> script. If its palette differs, resample the tokens in
> [src/theme.css](src/theme.css); nothing else needs to change.

Tokens live in [src/theme.css](src/theme.css). `--ink`, `--green` and
`--green-deep` are sampled from the logo's pixel palette. Mauve is not in the
logo, so it is chosen to sit beside that green without competing. The two
accents never touch at full saturation — nav (mauve) and template affordances
(green) stay in separate regions.

The logo renders only at integer multiples of its native size, with
`image-rendering: pixelated`. [src/components/Logo.tsx](src/components/Logo.tsx)
rounds the `scale` prop and computes the pixel dimensions from it rather than
letting CSS layout pick a fractional size.

Typography is Noto Serif throughout, latin subset, self-hosted.

## The template

Stored **only** as dimensionless ratios in the eye's own measured frame — never
pixel coordinates, never absolute angles ([src/wing.ts](src/wing.ts)):

| Parameter | Stored as |
| --- | --- |
| `tipLength` | Fraction of eye width |
| `tipAngleDeg` | Degrees offset from the measured canthal axis |
| `upperCurvature` | Control point offset from the anchor→tip chord, ÷ chord length |
| `lowerCurvature` | Same, lower chord |
| `upperAnchorRatio` | Position along the lid margin from the outer canthus |

### The eye frame

The trick that makes all of it work:

```
origin  the outer canthus
u       unit vector along the canthal axis, pointing AWAY from the nose
v       unit vector perpendicular to u, pointing UP toward the brow
scale   eye width in pixels
```

Both basis vectors are defined per eye, so `u` already points outward on
whichever side of the face the eye sits. A point written as `(a, b)` in that
frame therefore lands in mirrored positions on the two eyes from the *same*
numbers. That is why mirroring needs no sign flip and no pixel flipping — it
falls out of the basis.

All template maths happens in local coordinates and converts to canvas only at
the end, so mirror symmetry is structural rather than something to remember.

### Anchors

Both anchors are landmark-locked and not draggable, because they sit on the eye
and must follow it:

- `lowerAnchor` — the outer canthus (33 / 263)
- `upperAnchor` — a fixed fraction along the upper lid margin from the outer
  canthus

The fill closes back along the lid margin between them, so the base of the wing
hugs the lash line instead of cutting a straight chord across it.

## Landmark indices

Taken from MediaPipe's own `FACE_LANDMARKS_LEFT_EYE` / `..._RIGHT_EYE`
constants, not transcribed. Names are **anatomical** — the subject's own sides.

| Point | Subject's right eye | Subject's left eye |
| --- | --- | --- |
| Outer canthus (lateral) | **33** | **263** |
| Inner canthus (medial) | **133** | **362** |
| Upper lid apex | **159** | **386** |
| Lower lid nadir | **145** | **374** |

Upper lid margin, outer → inner (the first half of the ring walk):

```
right: 33, 246, 161, 160, 159, 158, 157, 173, 133
left: 263, 466, 388, 387, 386, 385, 384, 398, 362
```

The model returns **478** landmarks, not 468: `face_landmarker.task` includes
iris refinement, adding points 468–477. All measurement indices are inside the
original 468.

### Mirroring

The preview is mirrored, which — like a real mirror — *preserves* left/right
position: the subject's right eye appears on the **right** of the screen.

### Angle convention

Positive means the outer corner sits above the inner corner. The sign is
normalised per eye, so mirroring cannot flip it.

A head roll moves the two eye angles in **opposite** directions; a real canthal
tilt moves them the **same** way. So `mean(right, left)` is the roll-invariant
canthal tilt and `(right − left) / 2` is the head roll. Both are in the Face
axis metrics panel.

## Guide mode and the freeze gate

The template rebuilds from ratios every frame, so it rescales as you lean
toward the camera. When tracking degrades it **holds its last good position**
rather than jumping, and a `template held` badge appears.

MediaPipe exposes no confidence score, so the gate is built from derived
signals: detection rate, in-frame ratio, frame-to-frame jitter, and the
disagreement between the two eyes' measured angles.

> **One deliberate deviation from the spec.** The spec asks for a threshold on
> the left/right angle split. But because the angle convention is normalised
> per eye, that split is *arithmetically twice the head roll* — so thresholding
> its magnitude would freeze the template every time you tilt your head, which
> is the one thing you inevitably do while applying eyeliner.
>
> What actually indicates unreliable measurement is the split becoming
> **unstable**: a real head roll changes smoothly, degrading landmarks make the
> split jitter. So the gate watches the split's volatility (mean absolute
> deviation over a 15-frame window) instead of its magnitude. `npm run check`
> proves a large steady tilt passes and a thrashing split does not.

## Metrics

Every numeric readout sits behind the single **Metrics** toggle, off by
default, in a panel below the camera frame. The landmark debug cloud is tied to
the same toggle. When the template lands wrong, these numbers are how you find
out why.

Capture controls: <kbd>R</kbd> resets the min/max ranges, <kbd>space</kbd>
freezes the capture. Ranges accumulate at full frame rate, not the 10 Hz the
readout refreshes at, so a brief dip while leaning in still registers.

## Layout

```
src/landmarks.ts        indices + measurement geometry (pure)
src/wing.ts             template params, eye frame, Bézier resolution (pure)
src/trackingQuality.ts  derived confidence, ranges, freeze gate, FPS (pure)
src/draw.ts             canvas overlay + template rendering
src/useFaceTracker.ts   camera, model, per-frame loop
src/router.ts           hash routing
src/theme.css           colour tokens
src/pages/              home, draw, explore
src/components/         Logo, MetricsPanel, WingDesigner
scripts/                asset sync, logo generation, checks
```

The three pure modules carry no DOM types, which is what lets the Node-side
checks import them directly.

The per-frame loop uses `requestVideoFrameCallback` where available so
inference runs once per decoded frame rather than once per repaint. Drawing
happens every frame; React state updates at 10 Hz to avoid re-render churn.

## Not built yet

Saved presets or multiple looks · off-template warnings · lash-line guidance ·
per-eye independent shaping · undo/redo in the designer · photo capture or
export · `explore` beyond the placeholder.
