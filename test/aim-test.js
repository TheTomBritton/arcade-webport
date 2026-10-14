// Node tests for web/sinden/aim.js: the affine fit, the edge (off-screen)
// pass-through, the One Euro filter's jitter reduction and lag, and the engine
// config patching.
// Run: node aim-test.js
'use strict';
const path = require('path');

const A = require(path.join(__dirname, '..', 'sinden/aim.js'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); }
  else { failures++; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- affine fit ---------------------------------------------------------------

const GRID = [0.12, 0.5, 0.88];
const TARGETS = GRID.flatMap(y => GRID.map(x => [x, y]));
// a gun that reads 3 % right, 2 % low, and a little stretched horizontally
const truth = [0.96, 0.01, 0.01, -0.005, 0.98, -0.02];
const inv = (x, y) => {  // where the gun reads when aimed at (x, y): invert truth
  const [a, b, c, d, e, f] = truth, det = a * e - b * d;
  return [(e * (x - c) - b * (y - f)) / det, (a * (y - f) - d * (x - c)) / det];
};
const pairs = TARGETS.map(t => ({ raw: inv(...t), target: t }));
const fit = A.fitAffine(pairs);
check('affine fit recovers the correction', fit && fit.every((v, i) => near(v, truth[i], 1e-9)), JSON.stringify(fit));
check('affine maps each shot onto its target',
  pairs.every(({ raw, target }) => { const [x, y] = A.applyAffine(fit, ...raw); return near(x, target[0], 1e-9) && near(y, target[1], 1e-9); }));
check('affine fit refuses collinear points',
  A.fitAffine([0.1, 0.5, 0.9].map(x => ({ raw: [x, x], target: [x, x] }))) === null);
check('affine fit needs 3 points', A.fitAffine(pairs.slice(0, 2)) === null);

// a noisy shot set still fits closely (least squares, not exact)
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
const noisy = pairs.map(({ raw, target }) => ({ raw: [raw[0] + rnd() * 0.01, raw[1] + rnd() * 0.01], target }));
const nfit = A.fitAffine(noisy);
const nerr = Math.max(...TARGETS.map(t => { const [x, y] = A.applyAffine(nfit, ...inv(...t)); return Math.hypot(x - t[0], y - t[1]); }));
check('noisy shots fit within 1 %', nerr < 0.01, `max ${(nerr * 100).toFixed(2)} %`);

// --- the pipeline ---------------------------------------------------------------

const prof = Object.assign(A.defaults(), { affine: truth, smoothing: 0 });
const p0 = new A.Pipeline(prof);
const [cx, cy] = p0.push(0.5, 0.5, 0);
check('pipeline applies the correction', near(cx, 0.96 * 0.5 + 0.01 * 0.5 + 0.01, 1e-9) && near(cy, -0.005 * 0.5 + 0.98 * 0.5 - 0.02, 1e-9));
check('pipeline leaves the edge alone (off-screen reload)', JSON.stringify(p0.push(0, 0.4, 16)) === JSON.stringify([0, 0.4]));
check('pipeline leaves the far edge alone', JSON.stringify(p0.push(1, 0.4, 32)) === JSON.stringify([1, 0.4]));
const [ix, iy] = p0.push(0.003, 0.003, 48);
check('a corrected aim never lands on the edge', ix > A.EDGE && iy > A.EDGE, `${ix}, ${iy}`);
check('no correction when the caller says so', JSON.stringify(new A.Pipeline(prof).push(0.3, 0.6, 0, false)) === JSON.stringify([0.3, 0.6]));

// --- smoothing ------------------------------------------------------------------

check('smoothing 0 is off', A.filterParams(0) === null);
check('more smoothing = lower still cut-off', A.filterParams(8).minCutoff < A.filterParams(3).minCutoff);

// held still at the centre with camera-like jitter at 60 Hz
function shake(level) {
  const pipe = new A.Pipeline(Object.assign(A.defaults(), { smoothing: level }));
  seed = 11;
  const out = [];
  for (let i = 0; i < 300; i++) out.push(pipe.push(0.5 + rnd() * 0.006, 0.5 + rnd() * 0.006, i * 16.7, false));
  const tail = out.slice(60);
  const m = tail.reduce((a, [x]) => a + x, 0) / tail.length;
  return Math.sqrt(tail.reduce((a, [x]) => a + (x - m) ** 2, 0) / tail.length);
}
const rawShake = shake(0), smoothShake = shake(5);
check('smoothing 5 cuts held-still shake by more than half', smoothShake < rawShake * 0.5,
  `${(rawShake * 1000).toFixed(2)} -> ${(smoothShake * 1000).toFixed(2)} (thousandths of the screen)`);

// a fast swing across the screen: the filter must keep up (One Euro raises its cut-off)
{
  const pipe = new A.Pipeline(Object.assign(A.defaults(), { smoothing: 5 }));
  let lagMax = 0;
  for (let i = 0; i <= 30; i++) {           // half a screen in half a second
    const x = 0.25 + i / 60;
    const [fx] = pipe.push(x, 0.5, i * 16.7, false);
    if (i > 5) lagMax = Math.max(lagMax, x - fx);
  }
  check('smoothing 5 lags a fast swing by under 4 %', lagMax < 0.04, `${(lagMax * 100).toFixed(2)} %`);
}

// a pointermove and its mousemove arrive at the same moment: the second must not reset the filter
{
  const pipe = new A.Pipeline(Object.assign(A.defaults(), { smoothing: 5 }));
  pipe.push(0.5, 0.5, 0, false);
  const [a] = pipe.push(0.6, 0.5, 16.7, false);
  const [b] = pipe.push(0.6, 0.5, 16.7, false);
  check('a repeat at the same time stamp keeps the filtered position', a === b && a < 0.6, `${a} ${b}`);
}

// --- the 4:3 picture and its border -------------------------------------------------

{
  const bx = A.box(1920, 1080);
  check('16:9 screen: the 4:3 box is 1440x1080, centred', bx.x === 240 && bx.y === 0 && bx.w === 1440 && bx.h === 1080, JSON.stringify(bx));
  const b4 = A.box(1024, 768);
  check('4:3 screen: the box is the screen', b4.x === 0 && b4.y === 0 && b4.w === 1024 && b4.h === 768);
  const tall = A.box(1000, 1000);
  check('square screen: the box is letterboxed', tall.x === 0 && tall.w === 1000 && near(tall.h, 750, 1e-9) && near(tall.y, 125, 1e-9));
  check('border is % of the short edge, rounded down', A.borderPx(1440, 1080, 4) === 43 && A.borderPx(640, 480, 0) === 0);
  const p = A.pictureRect(1440, 1080, 4);
  check('picture sits inside the border, 4:3, centred',
    p.border === 43 && p.y === 43 && p.h === 994 && p.w === Math.round(994 * 4 / 3) && p.x === 43 + Math.floor((1354 - p.w) / 2), JSON.stringify(p));
  const n = A.pictureRect(640, 480, 0);
  check('no border: the picture is the whole area', n.x === 0 && n.y === 0 && n.w === 640 && n.h === 480 && n.border === 0);
}

// --- the engine's config ----------------------------------------------------------

const cfgText = '# my settings\nscale = 2\ngun_border=2\nvolume = 80\n';
const patched = A.patchCfg(cfgText, { gun_border: 4, crosshair: 0 });
check('patchCfg rewrites an existing key', /^gun_border = 4$/m.test(patched) && !/gun_border=2/.test(patched));
check('patchCfg appends a missing key', /^crosshair = 0$/m.test(patched));
check('patchCfg keeps the other lines', patched.startsWith('# my settings\nscale = 2\n') && /volume = 80/.test(patched));
check('patchCfg on an empty file', A.patchCfg('', { gun_border: 3 }) === 'gun_border = 3\n');
check('engineValues empty while off', Object.keys(A.engineValues(A.defaults())).length === 0);
check('engineValues when on', JSON.stringify(A.engineValues(Object.assign(A.defaults(), { enabled: true, borderPct: 3, crosshair: true }))) === '{"gun_border":3,"crosshair":1,"aspect":"stretch","widescreen":0,"window_mode":0,"fullscreen":0}');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
