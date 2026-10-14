/**
 * Geometry checks for the measurement and template maths. Run: `npm run check`.
 *
 * These pin down the things that are easy to get backwards: which side of the
 * mirrored preview each eye lands on, the sign of the canthal tilt, and that
 * the stored wing ratios really are invariant to head roll and scale.
 */
import {
  LEFT_EYE,
  RIGHT_EYE,
  measureEye,
  pathPoints,
  pointAlongPath,
  toCanvas,
  upperLidPath,
  type NormalizedPoint,
} from '../src/landmarks.ts';
import {
  canvasToLocal,
  curvatureFromPoint,
  eyeFrame,
  localToCanvas,
  resolveWing,
  type WingParams,
} from '../src/wing.ts';
import { LandmarkSmoother } from '../src/smoothing.ts';
import {
  TemplateGate,
  decomposeAngles,
  type TrackingQuality,
} from '../src/trackingQuality.ts';

const W = 1280;
const H = 720;

let failures = 0;

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function near(a: number, b: number, tol = 1e-6) {
  return Math.abs(a - b) <= tol;
}

/**
 * Build a synthetic face in SOURCE (unmirrored) normalized space.
 *
 * A raw webcam frame shows you the way a person facing you looks: the subject's
 * right eye sits at the LOW-x side of the image.
 */
function makeFace(opts: {
  rightTiltUp: number;
  leftTiltUp: number;
  /** Head roll in degrees, rotating the whole face about its centre. */
  rollDeg?: number;
}): NormalizedPoint[] {
  const pts: NormalizedPoint[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));

  /**
   * Lay a whole eye down: the 9-point upper lid margin as an arc from outer to
   * inner canthus, plus the lower lid point. The full margin matters because
   * the upper wing anchor rides it.
   */
  const buildEye = (eye: typeof RIGHT_EYE, outerX: number, innerX: number, tiltUp: number) => {
    const outerY = 0.4 - tiltUp;
    const innerY = 0.4;
    const path = upperLidPath(eye);
    for (let i = 0; i < path.length; i++) {
      const t = i / (path.length - 1);
      pts[path[i]] = {
        x: outerX + (innerX - outerX) * t,
        y: outerY + (innerY - outerY) * t - 0.03 * Math.sin(Math.PI * t),
      };
    }
    pts[eye.lowerLid] = { x: (outerX + innerX) / 2, y: 0.43 };
  };

  // Subject's right eye: low x. Outer canthus is the one further from the nose.
  buildEye(RIGHT_EYE, 0.3, 0.42, opts.rightTiltUp);
  // Subject's left eye: high x. Outer canthus further from the nose = higher x.
  buildEye(LEFT_EYE, 0.7, 0.58, opts.leftTiltUp);

  if (opts.rollDeg) {
    // A real head roll is a RIGID rotation in pixel space. Normalized x and y
    // are divided by different extents, so rotating normalized coords directly
    // would be a shear. Convert to pixels, rotate, convert back.
    const t = (opts.rollDeg * Math.PI) / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const cx = 0.5 * W;
    const cy = 0.4 * H;
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i].x * W - cx;
      const dy = pts[i].y * H - cy;
      pts[i] = {
        x: (cx + dx * cos - dy * sin) / W,
        y: (cy + dx * sin + dy * cos) / H,
      };
    }
  }

  return pts;
}

console.log('\nmirroring');
{
  const face = makeFace({ rightTiltUp: 0, leftTiltUp: 0 });
  const rightOuter = toCanvas(face[RIGHT_EYE.outerCanthus], W, H);
  const leftOuter = toCanvas(face[LEFT_EYE.outerCanthus], W, H);

  check(
    "subject's right eye renders on the RIGHT half of the mirrored canvas",
    rightOuter.x > W / 2,
    `x=${rightOuter.x}`,
  );
  check(
    "subject's left eye renders on the LEFT half of the mirrored canvas",
    leftOuter.x < W / 2,
    `x=${leftOuter.x}`,
  );
  check('mirroring leaves y untouched', near(rightOuter.y, 0.4 * H));
}

console.log('\nwidth / height');
{
  const face = makeFace({ rightTiltUp: 0, leftTiltUp: 0 });
  const right = measureEye(face, RIGHT_EYE, W, H)!;
  const left = measureEye(face, LEFT_EYE, W, H)!;

  check('right eye width = 0.12 * W', near(right.widthPx, 0.12 * W, 1e-9), `${right.widthPx}`);
  check('left eye width = 0.12 * W', near(left.widthPx, 0.12 * W, 1e-9), `${left.widthPx}`);
  check('right eye height = 0.06 * H', near(right.heightPx, 0.06 * H, 1e-9), `${right.heightPx}`);
  check('height/width ratio is positive', right.aspectRatio > 0);
}

console.log('\ncanthal tilt sign (positive = outer corner higher)');
{
  const level = makeFace({ rightTiltUp: 0, leftTiltUp: 0 });
  check('level eyes read 0°', near(measureEye(level, RIGHT_EYE, W, H)!.angleDeg, 0, 1e-9));
  check('level eyes read 0° (left)', near(measureEye(level, LEFT_EYE, W, H)!.angleDeg, 0, 1e-9));

  const up = makeFace({ rightTiltUp: 0.05, leftTiltUp: 0.05 });
  const rUp = measureEye(up, RIGHT_EYE, W, H)!.angleDeg;
  const lUp = measureEye(up, LEFT_EYE, W, H)!.angleDeg;
  check('upturned right eye reads positive', rUp > 0, `${rUp.toFixed(2)}°`);
  check('upturned left eye reads positive', lUp > 0, `${lUp.toFixed(2)}°`);
  check('both eyes agree in magnitude when tilted alike', near(rUp, lUp, 1e-9));

  const down = makeFace({ rightTiltUp: -0.05, leftTiltUp: -0.05 });
  const rDown = measureEye(down, RIGHT_EYE, W, H)!.angleDeg;
  const lDown = measureEye(down, LEFT_EYE, W, H)!.angleDeg;
  check('downturned right eye reads negative', rDown < 0, `${rDown.toFixed(2)}°`);
  check('downturned left eye reads negative', lDown < 0, `${lDown.toFixed(2)}°`);

  // 0.05 normalized y over 0.12 normalized x, scaled to pixels.
  const expected = (Math.atan2(0.05 * H, 0.12 * W) * 180) / Math.PI;
  check(`upturn magnitude matches atan2 (${expected.toFixed(2)}°)`, near(rUp, expected, 1e-9));
}

console.log('\nhead roll vs. true canthal tilt');
{
  // Pure head roll, no actual tilt in the eye geometry.
  const rolled = makeFace({ rightTiltUp: 0, leftTiltUp: 0, rollDeg: 8 });
  const r = measureEye(rolled, RIGHT_EYE, W, H)!.angleDeg;
  const l = measureEye(rolled, LEFT_EYE, W, H)!.angleDeg;

  check('pure roll pushes the two eyes in OPPOSITE directions', r * l < 0, `R=${r.toFixed(2)} L=${l.toFixed(2)}`);
  check('pure roll is antisymmetric — the eyes cancel', near(r + l, 0, 1e-9), `sum=${(r + l).toFixed(6)}`);

  // Genuine bilateral tilt, head level.
  const tilted = makeFace({ rightTiltUp: 0.02, leftTiltUp: 0.02 });
  const tr = measureEye(tilted, RIGHT_EYE, W, H)!.angleDeg;
  const tl = measureEye(tilted, LEFT_EYE, W, H)!.angleDeg;
  check('true tilt pushes both eyes the SAME direction', tr * tl > 0, `R=${tr.toFixed(2)} L=${tl.toFixed(2)}`);

  // Both at once: the mean recovers tilt, the half-difference recovers roll.
  const both = makeFace({ rightTiltUp: 0.02, leftTiltUp: 0.02, rollDeg: 8 });
  const br = measureEye(both, RIGHT_EYE, W, H)!.angleDeg;
  const bl = measureEye(both, LEFT_EYE, W, H)!.angleDeg;
  const meanAngle = (br + bl) / 2;
  const halfDiff = (br - bl) / 2;

  check(
    'mean of the two angles is roll-invariant (recovers true tilt)',
    Math.abs(meanAngle - (tr + tl) / 2) < 0.6,
    `mean=${meanAngle.toFixed(2)} vs level-head tilt=${((tr + tl) / 2).toFixed(2)}`,
  );
  check(
    'half-difference recovers the roll angle',
    Math.abs(halfDiff - 8) < 0.6,
    `halfDiff=${halfDiff.toFixed(2)} vs applied roll=8`,
  );
}

console.log('\nwing template geometry');
{
  const params: WingParams = {
    tipLength: 0.34,
    tipAngleDeg: 24,
    upperCurvature: 0.14,
    lowerCurvature: -0.05,
    upperAnchorRatio: 0.28,
  };
  const face = makeFace({ rightTiltUp: 0.01, leftTiltUp: 0.01 });
  const rEye = measureEye(face, RIGHT_EYE, W, H)!;
  const lEye = measureEye(face, LEFT_EYE, W, H)!;

  // --- the local frame ----------------------------------------------------
  const rFrame = eyeFrame(rEye);
  const lFrame = eyeFrame(lEye);

  const dot = (p: { x: number; y: number }, q: { x: number; y: number }) => p.x * q.x + p.y * q.y;
  const len = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);

  check('frame basis is orthonormal', near(len(rFrame.u), 1, 1e-9) && near(len(rFrame.v), 1, 1e-9) && near(dot(rFrame.u, rFrame.v), 0, 1e-9));
  check('u points away from the nose on both eyes', (rFrame.u.x > 0) !== (lFrame.u.x > 0));
  check('v points toward the brow on both eyes', rFrame.v.y < 0 && lFrame.v.y < 0, `R=${rFrame.v.y.toFixed(3)} L=${lFrame.v.y.toFixed(3)}`);

  const probe = { a: 0.31, b: 0.17 };
  const round = canvasToLocal(rFrame, localToCanvas(rFrame, probe));
  check('local <-> canvas round-trips', near(round.a, probe.a, 1e-9) && near(round.b, probe.b, 1e-9));

  // --- mirror symmetry ----------------------------------------------------
  const rWing = resolveWing(face, RIGHT_EYE, rEye, params, W, H)!;
  const lWing = resolveWing(face, LEFT_EYE, lEye, params, W, H)!;

  check('same params resolve on both eyes', rWing !== null && lWing !== null);
  check(
    'identical params give mirrored tips (same height, opposite side)',
    near(rWing.tip.y, lWing.tip.y, 1e-6) && (rWing.tip.x - W / 2) * (lWing.tip.x - W / 2) < 0,
    `Ry=${rWing.tip.y.toFixed(2)} Ly=${lWing.tip.y.toFixed(2)}`,
  );
  check(
    'mirrored control points too',
    near(rWing.upperControl.y, lWing.upperControl.y, 1e-6) &&
      near(rWing.lowerControl.y, lWing.lowerControl.y, 1e-6),
  );
  check('tip sits above the outer canthus on both eyes', rWing.tip.y < rWing.lowerAnchor.y && lWing.tip.y < lWing.lowerAnchor.y);
  check('lower anchor is exactly the outer canthus', rWing.lowerAnchor === rEye.outer);

  // --- stored ratios are dimensionless ------------------------------------
  const tipLocal = canvasToLocal(rFrame, rWing.tip);
  check('tip length recovers as a fraction of eye width', near(Math.hypot(tipLocal.a, tipLocal.b), params.tipLength, 1e-9));
  check(
    'tip angle recovers as an offset from the canthal axis',
    near((Math.atan2(tipLocal.b, tipLocal.a) * 180) / Math.PI, params.tipAngleDeg, 1e-9),
  );

  const upperLocal = canvasToLocal(rFrame, rWing.upperAnchor);
  check(
    'upper curvature round-trips through the control point',
    near(curvatureFromPoint(upperLocal, tipLocal, canvasToLocal(rFrame, rWing.upperControl)), params.upperCurvature, 1e-9),
  );
  check(
    'lower curvature round-trips through the control point',
    near(curvatureFromPoint({ a: 0, b: 0 }, tipLocal, canvasToLocal(rFrame, rWing.lowerControl)), params.lowerCurvature, 1e-9),
  );
  check(
    'zero curvature puts the control on the chord midpoint',
    (() => {
      const flat = resolveWing(face, RIGHT_EYE, rEye, { ...params, lowerCurvature: 0 }, W, H)!;
      const mid = { x: (flat.lowerAnchor.x + flat.tip.x) / 2, y: (flat.lowerAnchor.y + flat.tip.y) / 2 };
      return near(flat.lowerControl.x, mid.x, 1e-6) && near(flat.lowerControl.y, mid.y, 1e-6);
    })(),
  );

  // --- head roll ----------------------------------------------------------
  const rolled = makeFace({ rightTiltUp: 0.01, leftTiltUp: 0.01, rollDeg: 14 });
  const rEyeRolled = measureEye(rolled, RIGHT_EYE, W, H)!;
  const rWingRolled = resolveWing(rolled, RIGHT_EYE, rEyeRolled, params, W, H)!;
  const rolledLocal = canvasToLocal(eyeFrame(rEyeRolled), rWingRolled.tip);

  check(
    'roll moves the wing in image space',
    Math.hypot(rWingRolled.tip.x - rWing.tip.x, rWingRolled.tip.y - rWing.tip.y) > 5,
  );
  check(
    'but the stored ratios are UNCHANGED by roll',
    near(Math.hypot(rolledLocal.a, rolledLocal.b), params.tipLength, 1e-9) &&
      near((Math.atan2(rolledLocal.b, rolledLocal.a) * 180) / Math.PI, params.tipAngleDeg, 1e-9),
  );

  // --- scale --------------------------------------------------------------
  const bigEye = measureEye(face, RIGHT_EYE, W * 2, H * 2)!;
  const bigWing = resolveWing(face, RIGHT_EYE, bigEye, params, W * 2, H * 2)!;
  const bigLocal = canvasToLocal(eyeFrame(bigEye), bigWing.tip);
  const smallLen = Math.hypot(rWing.tip.x - rWing.lowerAnchor.x, rWing.tip.y - rWing.lowerAnchor.y);
  const bigLen = Math.hypot(bigWing.tip.x - bigWing.lowerAnchor.x, bigWing.tip.y - bigWing.lowerAnchor.y);
  check('a doubled face gives a doubled wing', near(bigLen / smallLen, 2, 1e-6), `${smallLen.toFixed(1)} -> ${bigLen.toFixed(1)}`);
  check('with the ratios unchanged', near(Math.hypot(bigLocal.a, bigLocal.b), params.tipLength, 1e-9));

  // --- anchors ride the lid ------------------------------------------------
  const lidPts = pathPoints(face, upperLidPath(RIGHT_EYE), W, H)!;
  check('upper anchor lies on the lid margin', near(pointAlongPath(lidPts, params.upperAnchorRatio).x, rWing.upperAnchor.x, 1e-9));
  check('ratio 0 puts the upper anchor at the outer canthus', near(pointAlongPath(lidPts, 0).x, rEye.outer.x, 1e-9));
  check('lid return path closes back toward the outer canthus', rWing.lidReturn.length >= 2);
}

console.log('\ntemplate freeze gate');
{
  const good: TrackingQuality = {
    score: 0.95,
    detectionRate: 1,
    inFrameRatio: 1,
    stability: 0.95,
    present: true,
  };

  // Fill the window so the volatility term is live.
  const run = (angles: Array<[number, number]>, quality: TrackingQuality = good) => {
    const gate = new TemplateGate();
    let last = gate.update(quality, angles[0][0], angles[0][1]);
    for (const [r, l] of angles) last = gate.update(quality, r, l);
    return last;
  };

  const steady = Array.from({ length: 30 }, () => [3, 3] as [number, number]);
  check('steady, well-tracked eyes pass the gate', run(steady).ok);

  // A held head tilt: the split is LARGE (2x the roll) but perfectly stable.
  // Thresholding on magnitude would freeze here, which is the bug being avoided.
  const tilted = Array.from({ length: 30 }, () => [18, -12] as [number, number]);
  const tiltedState = run(tilted);
  check(
    'a large but steady head tilt does NOT freeze the template',
    tiltedState.ok,
    `split=${tiltedState.disagreementDeg.toFixed(1)}° volatility=${tiltedState.disagreementVolatilityDeg.toFixed(2)}°`,
  );

  // Same average split, but thrashing frame to frame.
  const jittery = Array.from({ length: 30 }, (_, i) =>
    i % 2 === 0 ? ([18, -12] as [number, number]) : ([2, 1] as [number, number]),
  );
  const jitteryState = run(jittery);
  check(
    'an unstable split DOES freeze the template',
    !jitteryState.ok && jitteryState.reasons.includes('eye angles unstable'),
    `volatility=${jitteryState.disagreementVolatilityDeg.toFixed(2)}°`,
  );

  check(
    'a cropped face freezes the template',
    run(steady, { ...good, inFrameRatio: 0.4 }).reasons.includes('face cropped'),
  );
  check(
    'dropped frames freeze the template',
    run(steady, { ...good, detectionRate: 0.2 }).reasons.includes('dropped frames'),
  );
  check(
    'jitter freezes the template',
    run(steady, { ...good, stability: 0.1 }).reasons.includes('jitter'),
  );
  check('a missing face freezes the template', (() => {
    const gate = new TemplateGate();
    return gate.update({ ...good, present: false }, null, null).reasons.includes('no face');
  })());

  check(
    'the split is exactly twice the head roll',
    (() => {
      const gate = new TemplateGate();
      const s = gate.update(good, 18, -12);
      const roll = decomposeAngles(18, -12).headRollDeg;
      return near(s.disagreementDeg, Math.abs(2 * roll), 1e-9);
    })(),
  );
}

console.log('\nlandmark smoothing');
{
  const sd = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  };
  // Deterministic pseudo-noise so the check cannot flake.
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed / 2147483648 - 0.5) * 0.004; // +/-2e-3, typical landmark jitter
  };

  // (a) A still face: smoothing should cut the wobble substantially.
  const sm = new LandmarkSmoother();
  const rawStill: number[] = [];
  const outStill: number[] = [];
  for (let i = 0; i < 90; i++) {
    const x = 0.5 + noise();
    rawStill.push(x);
    outStill.push(sm.smooth([{ x, y: 0.5 }], (i * 1000) / 30)[0].x);
  }
  const tail = (xs: number[]) => xs.slice(30);
  const reduction = sd(tail(rawStill)) / sd(tail(outStill));
  check(
    'a still face is smoothed at least 3x',
    reduction >= 3,
    `jitter cut ${reduction.toFixed(1)}x`,
  );

  // (b) Leaning in: a real move must still be tracked, not dragged behind.
  const sm2 = new LandmarkSmoother();
  let last = 0;
  for (let i = 0; i < 90; i++) {
    const t = i / 30;
    const x = 0.3 + Math.min(1, t / 1.5) * 0.3 + noise(); // 0.3 -> 0.6 over 1.5s
    last = sm2.smooth([{ x, y: 0.5 }], (i * 1000) / 30)[0].x;
  }
  check(
    'a deliberate move is followed, not lagged',
    Math.abs(last - 0.6) < 0.01,
    `settled at ${last.toFixed(4)} vs target 0.6`,
  );

  // (c) Losing the face must not drag the next detection in from the old pose.
  const sm3 = new LandmarkSmoother();
  for (let i = 0; i < 30; i++) sm3.smooth([{ x: 0.2, y: 0.5 }], (i * 1000) / 30);
  sm3.reset();
  const after = sm3.smooth([{ x: 0.8, y: 0.5 }], 2000)[0].x;
  check('reset drops the old pose entirely', near(after, 0.8, 1e-9), `${after}`);
}

console.log('\nindex sanity');
{
  const all = [...RIGHT_EYE.ring, ...LEFT_EYE.ring];
  check('rings are 16 points each', RIGHT_EYE.ring.length === 16 && LEFT_EYE.ring.length === 16);
  check('no duplicate indices across both rings', new Set(all).size === all.length);
  check(
    'every index is inside the 468-point mesh',
    all.every((i) => i >= 0 && i < 468),
  );
  check(
    'corners and lid points are members of their own ring',
    [RIGHT_EYE, LEFT_EYE].every((e) =>
      [e.outerCanthus, e.innerCanthus, e.upperLid, e.lowerLid].every((i) => e.ring.includes(i)),
    ),
  );
  check(
    'upper and lower lid points sit on opposite sides of the ring walk',
    Math.abs(RIGHT_EYE.ring.indexOf(RIGHT_EYE.upperLid) - RIGHT_EYE.ring.indexOf(RIGHT_EYE.lowerLid)) === 8,
  );
}

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
