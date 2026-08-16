# aEye — M1

Face landmark tracking plus wing anchor geometry. Vite + React + TypeScript,
MediaPipe Face Landmarker, Canvas 2D overlay on a mirrored webcam feed.

Everything runs client-side. The wasm runtime and the model are served from
this app's own origin (`public/mediapipe/`), so no frames and no requests leave
the device once the page has loaded.

## Running

```bash
npm install
npm run dev      # syncs MediaPipe assets, then serves on :5173
```

`npm run dev` and `npm run build` both run `scripts/sync-mediapipe-assets.mjs`
first, which copies the wasm out of `node_modules` and downloads
`face_landmarker.task` (3.76 MB) into `public/mediapipe/`. That directory is
gitignored — it is ~35 MB of generated artifacts.

Camera access needs a secure context: `localhost` works, a bare LAN IP will not.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build |
| `npm run check` | Geometry checks for the measurement math |
| `npm run lint` | oxlint |

## Landmark indices

Taken from MediaPipe's own shipped constants
(`FaceLandmarker.FACE_LANDMARKS_LEFT_EYE` / `..._RIGHT_EYE`), not from a blog
post. Defined in [src/landmarks.ts](src/landmarks.ts).

Names are **anatomical** — the subject's own left and right.

| Point | Subject's right eye | Subject's left eye |
| --- | --- | --- |
| Outer canthus (lateral, toward ear) | **33** | **263** |
| Inner canthus (medial, toward nose) | **133** | **362** |
| Upper lid apex | **159** | **386** |
| Lower lid nadir | **145** | **374** |

Full 16-point lid rings, in walk order from the outer canthus — upper lid
first, then back along the lower lid:

```
right: 33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7
left: 263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249
```

Iris rings (present only because the model emits 478 points, see below):

```
right: 469, 470, 471, 472    centre 468
left:  474, 475, 476, 477    centre 473
```

### The model returns 478 landmarks, not 468

`face_landmarker.task` includes the iris refinement, so `faceLandmarks[0]`
has 478 entries: the 468-point mesh plus 10 iris points (468–477). The overlay
draws all of them and the debug readout shows the live count. All four
measurement indices above are inside the original 468.

### Mirroring

The preview is mirrored, which — like a real mirror — *preserves* left/right
position: the subject's right eye appears on the **right** of the screen. An
unmirrored camera frame is the opposite, because it shows you the way a person
facing you would look.

`toCanvas()` flips x (`(1 - x) * width`) so drawn landmarks line up with the
CSS-mirrored `<video>`.

### Angle convention

`angleDeg` is the canthal tilt: the inner→outer canthus axis measured against
horizontal, in degrees.

**Positive means the outer corner sits higher than the inner corner** — the
upturned direction a wing follows. The sign is normalised so both eyes read the
same way, and so mirroring the preview cannot flip it. Distances are in
canvas backing-store pixels, which equal source video pixels.

`npm run check` pins all of this down.

## Min/max capture

Reading live numbers is impossible at the distance you'd actually apply
eyeliner — your face is too close to the panel and you are looking at your eye,
not the screen. So the readout captures min/max across a run:

| Control | Key | Effect |
| --- | --- | --- |
| Reset ranges | <kbd>R</kbd> | Clears the capture and starts a fresh window |
| Freeze | <kbd>space</kbd> | Holds the capture so later movement cannot pollute it |

Protocol: press <kbd>R</kbd>, lean in and hold, sit back, press <kbd>space</kbd>,
then read the min–max under each value.

Capture accumulates at full frame rate, not at the 10 Hz the readout refreshes,
so a brief dip while leaning in still registers.

## Canthal tilt vs. head roll

The per-eye angle is measured against the image horizontal, so it mixes two
different things: the eye's real tilt and whatever roll the head happens to
have. They separate cleanly, because the sign convention is normalised per eye:

- a **head roll** moves the two eye angles in **opposite** directions
- a **real canthal tilt** moves them the **same** direction

So `mean(right, left)` is the roll-invariant canthal tilt, and
`(right - left) / 2` is the head roll. Both are shown in the "Face axis" panel
and proved in `scripts/landmarks.check.ts`.

This matters for the wing: a template angle expressed as an offset from the
measured canthal axis survives head roll, whereas an absolute image-space angle
does not.

## Tracking confidence is derived, not reported

`FaceLandmarkerResult` exposes only `faceLandmarks`, `faceBlendshapes` and
`facialTransformationMatrixes`. There is **no confidence score in the API** —
`minFaceDetectionConfidence` and friends gate detection internally but are
never surfaced.

So [src/trackingQuality.ts](src/trackingQuality.ts) builds a proxy from three
observable signals, each shown separately in the readout so a low score is
diagnosable:

- **detection rate** — fraction of the last 30 frames that produced a face
- **in-frame ratio** — fraction of landmarks inside the frame bounds; MediaPipe
  extrapolates past the edges, so this is what catches a cropped face
- **stability** — inverse of mean frame-to-frame landmark displacement

The UI labels this `derived`. Do not read it as model confidence.

## M1 — wing anchors

The wing is stored in terms of the face, never the image
([src/wing.ts](src/wing.ts)):

| Field | Meaning |
| --- | --- |
| origin | The outer canthus, landmark 33 / 263 |
| `angleOffsetDeg` | Degrees **above the measured canthal axis** |
| `lengthRatio` | Tip distance as a **fraction of measured eye width** |

Resolution to pixels happens at draw time from the live measurement, which is
what buys the two invariances that matter:

- **Head roll.** The screen angle changes as you tilt, but the offset from the
  canthal axis does not — so the wing stays put on the face.
- **Scale.** The same spec produces a proportionally longer wing on a larger
  face or a closer camera, with the angle unchanged.

Direction is built from `eye.angleDeg + offset` rather than by rotating a raw
vector, so it inherits the mirror-safe sign convention `measureEye` already
establishes — positive is "tip up" for both eyes even though they point in
opposite directions across the screen.

Both invariances, plus mirror symmetry and the degenerate zero-offset case, are
proved in `scripts/landmarks.check.ts`.

The defaults (20° above axis, 0.30 × eye width) are placeholders standing in
until the parameter controls exist.

## Layout

```
src/landmarks.ts        indices + measurement geometry (pure)
src/wing.ts             M1 wing anchor spec + resolution (pure)
src/trackingQuality.ts  derived confidence, ranges, FPS meters (pure)
src/draw.ts             canvas overlay
src/useFaceTracker.ts   camera, model, per-frame loop
src/App.tsx             wiring + debug readout
scripts/                asset sync, geometry checks
```

Per-eye detail sits behind the "Show per-eye debug" toggle. It is hidden, not
removed — M2 needs it back.

The per-frame loop uses `requestVideoFrameCallback` where available so
inference runs once per decoded frame rather than once per repaint, falling
back to `requestAnimationFrame`. Drawing happens every frame; the React debug
numbers update at 10 Hz to avoid re-render churn.

## Not built yet

Parameter controls for the wing spec, the filled wing shape, preset controls,
guide mode, styling beyond legibility.
