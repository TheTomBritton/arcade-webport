// Sinden border tracking, phase-2 prototype: find the bright border
// quadrilateral in a camera frame and map the image centre (where the gun
// points) into screen coordinates via a homography.
//
// Scope: the PLAIN white border with all four edges visible. The gun's camera
// sees the screen as the dominant bright quad (at the right exposure the frame
// is otherwise near-black, per the sindenrs hardware notes). Partial borders,
// coded-tab identification and lens undistortion are out of scope here; the
// clean-room sindenrs project (MIT) shows how far that can be taken.
//
// Pipeline: threshold -> largest connected bright component -> convex hull of
// its run endpoints -> initial corners from the diagonal extremes -> each side
// refined by a total-least-squares line fit over its hull points -> corner
// intersections -> homography (DLT) -> aim = image centre mapped to the unit
// square. The gun's camera is mounted upside down, so aim is flipped by
// default.
'use strict';

const SindenTracker = (() => {

  // --- Connected components over thresholded pixels (scanline runs + union-find)

  function findRuns(luma, w, h, threshold) {
    const runs = []; // {row, x0, x1} inclusive
    for (let y = 0; y < h; y++) {
      const base = y * w;
      let x = 0;
      while (x < w) {
        if (luma[base + x] >= threshold) {
          let x0 = x;
          while (x < w && luma[base + x] >= threshold) x++;
          runs.push({ row: y, x0, x1: x - 1, label: runs.length });
        } else x++;
      }
    }
    return runs;
  }

  function largestComponent(runs) {
    if (!runs.length) return null;
    const parent = new Int32Array(runs.length);
    for (let i = 0; i < runs.length; i++) parent[i] = i;
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

    // runs are row-ordered; link overlapping runs on adjacent rows
    let rowStart = 0;
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      while (rowStart < i && runs[rowStart].row < r.row - 1) rowStart++;
      for (let j = rowStart; j < i; j++) {
        const p = runs[j];
        if (p.row !== r.row - 1) continue;
        if (p.x1 >= r.x0 && p.x0 <= r.x1) union(j, i);
      }
    }
    const size = new Map();
    for (let i = 0; i < runs.length; i++) {
      const root = find(i);
      size.set(root, (size.get(root) || 0) + runs[i].x1 - runs[i].x0 + 1);
    }
    let best = -1, bestSize = 0;
    for (const [root, s] of size) if (s > bestSize) { best = root; bestSize = s; }
    return { runs: runs.filter((_, i) => find(i) === best), pixels: bestSize };
  }

  // --- Convex hull (Andrew monotone chain) over the component's run endpoints

  function hullPoints(componentRuns) {
    const pts = [];
    for (const r of componentRuns) {
      pts.push([r.x0, r.row]);
      if (r.x1 !== r.x0) pts.push([r.x1, r.row]);
    }
    return convexHull(pts);
  }

  function convexHull(pts) {
    if (pts.length < 3) return pts.slice();
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  // --- Quad corners: diagonal extremes, then per-side line fits ----------------

  function initialCorners(hull) {
    let tl = hull[0], tr = hull[0], br = hull[0], bl = hull[0];
    for (const p of hull) {
      if (p[0] + p[1] < tl[0] + tl[1]) tl = p;
      if (p[0] - p[1] > tr[0] - tr[1]) tr = p;
      if (p[0] + p[1] > br[0] + br[1]) br = p;
      if (p[0] - p[1] < bl[0] - bl[1]) bl = p;
    }
    return [tl, tr, br, bl];
  }

  // Total-least-squares line through points: returns [a, b, c] with ax+by+c=0, a²+b²=1.
  function fitLine(pts) {
    let mx = 0, my = 0;
    for (const p of pts) { mx += p[0]; my += p[1]; }
    mx /= pts.length; my /= pts.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of pts) {
      const dx = p[0] - mx, dy = p[1] - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    // normal = eigenvector of the smaller eigenvalue of [[sxx,sxy],[sxy,syy]]
    const tr2 = (sxx + syy) / 2;
    const det = sxx * syy - sxy * sxy;
    const l = tr2 - Math.sqrt(Math.max(0, tr2 * tr2 - det)); // smaller eigenvalue
    let a = sxy, b = l - sxx;
    if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) { a = l - syy; b = sxy; }
    if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) { a = 1; b = 0; }
    const n = Math.hypot(a, b);
    a /= n; b /= n;
    return [a, b, -(a * mx + b * my)];
  }

  function intersectLines(l1, l2) {
    const d = l1[0] * l2[1] - l2[0] * l1[1];
    if (Math.abs(d) < 1e-9) return null;
    return [(l1[1] * l2[2] - l2[1] * l1[2]) / d, (l2[0] * l1[2] - l1[0] * l2[2]) / d];
  }

  function refineCorners(hull, corners) {
    // assign each hull point to its nearest side; drop points hugging a corner
    const sides = [[], [], [], []]; // top, right, bottom, left (corner i -> i+1)
    const segs = [0, 1, 2, 3].map(i => [corners[i], corners[(i + 1) % 4]]);
    const sideLen = segs.map(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]));
    for (const p of hull) {
      let bi = -1, bd = Infinity, bt = 0;
      for (let i = 0; i < 4; i++) {
        const [s, e] = segs[i];
        const vx = e[0] - s[0], vy = e[1] - s[1];
        const L2 = vx * vx + vy * vy;
        if (L2 < 1) continue;
        let t = ((p[0] - s[0]) * vx + (p[1] - s[1]) * vy) / L2;
        t = Math.min(1, Math.max(0, t));
        const dx = p[0] - (s[0] + t * vx), dy = p[1] - (s[1] + t * vy);
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bi = i; bt = t; }
      }
      // keep the middle 80% of each side: corner pixels are rounded by blur/threshold
      if (bi >= 0 && bt > 0.1 && bt < 0.9 && sideLen[bi] > 8) sides[bi].push(p);
    }
    const lines = sides.map((pts, i) => pts.length >= 2 ? fitLine(pts) : null);
    const out = corners.map(c => c.slice());
    for (let i = 0; i < 4; i++) {
      const la = lines[(i + 3) % 4], lb = lines[i]; // corner i = prev side ∩ this side
      if (la && lb) {
        const p = intersectLines(la, lb);
        // trust the refinement only if it stays near the initial guess
        if (p && Math.hypot(p[0] - corners[i][0], p[1] - corners[i][1]) < 20) out[i] = p;
      }
    }
    return out;
  }

  // --- Homography --------------------------------------------------------------

  // H mapping src[i] -> dst[i] (4 point pairs), as a row-major 3x3.
  function homography(src, dst) {
    // build the 8x9 DLT system, solve the 8x8 with h9 = 1
    const A = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    // gaussian elimination with partial pivoting on the 8x8 (last col = rhs)
    const M = A.map(r => r.slice(0, 8));
    const b = A.map(r => r[8]);
    for (let c = 0; c < 8; c++) {
      let piv = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      [M[c], M[piv]] = [M[piv], M[c]];
      [b[c], b[piv]] = [b[piv], b[c]];
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        if (!f) continue;
        for (let k = c; k < 8; k++) M[r][k] -= f * M[c][k];
        b[r] -= f * b[c];
      }
    }
    const hv = b.map((v, i) => v / M[i][i]);
    return [hv[0], hv[1], hv[2], hv[3], hv[4], hv[5], hv[6], hv[7], 1];
  }

  function applyHomography(H, x, y) {
    const wInv = 1 / (H[6] * x + H[7] * y + H[8]);
    return [(H[0] * x + H[1] * y + H[2]) * wInv, (H[3] * x + H[4] * y + H[5]) * wInv];
  }

  const UNIT_SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]];

  // --- Top level -----------------------------------------------------------------

  // Detect the border quad in a grayscale frame. Returns
  // { quad: [[x,y]x4 TL,TR,BR,BL], pixels } or null.
  function detectBorder(luma, w, h, { threshold = 128, minPixels = 0 } = {}) {
    const runs = findRuns(luma, w, h, threshold);
    const comp = largestComponent(runs);
    if (!comp) return null;
    const min = minPixels || Math.max(64, (w * h) * 0.002);
    if (comp.pixels < min) return null;
    const hull = hullPoints(comp.runs);
    if (hull.length < 4) return null;
    let corners = initialCorners(hull);
    // degenerate (e.g. a line): corners must span a real area
    const area = Math.abs(
      (corners[1][0] - corners[0][0]) * (corners[3][1] - corners[0][1]) -
      (corners[3][0] - corners[0][0]) * (corners[1][1] - corners[0][1]));
    if (area < 64) return null;
    corners = refineCorners(hull, corners);
    return { quad: corners, pixels: comp.pixels };
  }

  // Map the image centre through the quad. flip=true (default) accounts for the
  // gun's camera being mounted 180° rotated. Returns {x, y} in screen fractions
  // (0..1 inside the border's outer edge) — may be outside 0..1 when aiming off.
  function aimFromQuad(quad, w, h, { flip = true, offset = { x: 0, y: 0 } } = {}) {
    const H = homography(quad, UNIT_SQUARE);
    if (!H) return null;
    let [x, y] = applyHomography(H, w / 2, h / 2);
    if (flip) { x = 1 - x; y = 1 - y; }
    return { x: x + offset.x, y: y + offset.y };
  }

  // One-call convenience used by the live page.
  function track(luma, w, h, opts = {}) {
    const t0 = performance.now();
    const det = detectBorder(luma, w, h, opts);
    if (!det) return { quad: null, aim: null, ms: performance.now() - t0 };
    const aim = aimFromQuad(det.quad, w, h, opts);
    return { quad: det.quad, aim, pixels: det.pixels, ms: performance.now() - t0 };
  }

  // Luma from RGBA ImageData bytes (Rec. 601 integer approximation).
  function lumaFromRGBA(data, w, h) {
    const out = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      out[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    }
    return out;
  }

  return {
    detectBorder, aimFromQuad, track, lumaFromRGBA,
    homography, applyHomography, convexHull, fitLine, intersectLines,
    UNIT_SQUARE,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SindenTracker;
