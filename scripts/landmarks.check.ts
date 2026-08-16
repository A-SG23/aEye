/**
 * Geometry checks for the M0 measurements. Run: `npm run check`.
 *
 * These pin down the two things that are easy to get backwards: which side of
 * the mirrored preview each eye lands on, and the sign of the canthal tilt.
 */
import {
  LEFT_EYE,
  RIGHT_EYE,
  measureEye,
  toCanvas,
  type NormalizedPoint,
} from '../src/landmarks.ts';

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

  // Subject's right eye: low x. Outer canthus is the one further from the nose.
  const rOuterX = 0.30;
  const rInnerX = 0.42;
  pts[RIGHT_EYE.outerCanthus] = { x: rOuterX, y: 0.4 - opts.rightTiltUp };
  pts[RIGHT_EYE.innerCanthus] = { x: rInnerX, y: 0.4 };
  pts[RIGHT_EYE.upperLid] = { x: 0.36, y: 0.37 };
  pts[RIGHT_EYE.lowerLid] = { x: 0.36, y: 0.43 };

  // Subject's left eye: high x. Outer canthus further from the nose = higher x.
  const lInnerX = 0.58;
  const lOuterX = 0.70;
  pts[LEFT_EYE.outerCanthus] = { x: lOuterX, y: 0.4 - opts.leftTiltUp };
  pts[LEFT_EYE.innerCanthus] = { x: lInnerX, y: 0.4 };
  pts[LEFT_EYE.upperLid] = { x: 0.64, y: 0.37 };
  pts[LEFT_EYE.lowerLid] = { x: 0.64, y: 0.43 };

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
