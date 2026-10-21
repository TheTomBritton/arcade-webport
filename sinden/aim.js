// Light-gun aim layer for the game pages: sits between the browser's mouse
// events and the engine's canvas, and applies the profile the calibration
// suite (/arcade/calibrate/) saves.
//
// A Sinden (or any absolute-mouse gun) reaches the page as an ordinary mouse.
// Its aim is a little off (the gun's own calibration) and a little shaky (the
// camera's solve wobbles by a fraction of a pixel, magnified when the screen
// is small in its view). This layer intercepts every mouse and pointer event bound
// for the canvas in the capture phase, before the engine's handlers see it, and
// re-dispatches it with the position corrected and smoothed:
//
//   raw (fraction of the viewport) -> affine correction -> One Euro filter
//
// The correction is a 2x3 affine fitted from the 9-point calibration, applied
// only while the game is fullscreen (it is fitted against the whole screen).
// Fullscreen, the corrected fraction lands on the canvas's own rectangle, which
// is the whole screen for a fullscreen canvas or the 4:3 box in a wrapper.
// The One Euro filter (Casiez et al., CHI 2012) smooths hard while the aim is
// still and hardly at all while it moves, so jitter goes without adding lag to
// a swing. The screen's outermost pixel means off-screen to the engine (that
// is how reload works), so positions on the edge pass through untouched.
//
// It also keeps the OS cursor hidden over the fullscreen game (SDL resets the
// canvas's inline cursor style whenever its menu opens or closes) and blocks
// the context menu, which the gun's right-click pedal would otherwise open.
//
// The same profile tells the game page what to write into the engine's config
// before boot (crosshair, keys), and sizes the light gun's frame the page draws
// round the canvas (lib/cabinet.js), so the game and the suite agree.
//
// v7: the border is the page's (Cabinet.frame), not the engine's: install() takes
// { frame } - the element whose rectangle the gun's fraction maps to fullscreen
// (the frame's outer edge, which the driver maps to the whole screen) - and
// engineValues asks the engines for no border of their own. gapOverlay is gone
// with it.
'use strict';

const SindenAim = (() => {

  const KEY = 'arcade.sinden.aim.v1';
  const IDENTITY = [1, 0, 0, 0, 1, 0];      // x' = a x + b y + c, y' = d x + e y + f
  const EDGE = 0.0015;                      // within this fraction of an edge = on it
  const ASPECT = 4 / 3;                     // every game here runs at its original 4:3

  function defaults() {
    return {
      version: 1,
      enabled: false,            // apply correction + smoothing in the games
      affine: IDENTITY.slice(),
      smoothing: 5,              // 0 (off) .. 10 (heaviest), see filterParams
      borderPct: 4,              // the engine's gun_border, 0..6 % of the short edge
      gapPct: 2,                 // a black gap inside the white border, % of the short edge (see innerGap)
      crosshair: false,          // the engine's aiming cross
      hideCursor: true,
      crt: { enabled: false, brightness: 100, scanlines: 50, mask: 20, blur: 50 },   // sinden/crt.js; F9 in the games
      calibratedAt: null,
      stats: null,               // what the last calibration measured, for display
    };
  }

  function load() {
    try {
      const p = JSON.parse(localStorage.getItem(KEY));
      if (p && p.version === 1) return Object.assign(defaults(), p);
    } catch (_) { /* unreadable or blocked storage: run on defaults */ }
    return defaults();
  }

  function save(profile) {
    try { localStorage.setItem(KEY, JSON.stringify(profile)); return true; }
    catch (_) { return false; }
  }

  // --- the correction --------------------------------------------------------

  function applyAffine(m, x, y) {
    return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
  }

  // Solve the 3x3 system A v = b by Cramer's rule; null when singular.
  function solve3(A, b) {
    const det = (M) =>
      M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
      M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
      M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const d = det(A);
    if (Math.abs(d) < 1e-12) return null;
    return [0, 1, 2].map(col => det(A.map((row, i) => row.map((v, j) => (j === col ? b[i] : v)))) / d);
  }

  // Least-squares affine taking each measured point to its target.
  // pairs: [{ raw: [x, y], target: [x, y] }], at least 3 not all on a line.
  function fitAffine(pairs) {
    if (pairs.length < 3) return null;
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const bx = [0, 0, 0], by = [0, 0, 0];
    for (const { raw: [x, y], target: [tx, ty] } of pairs) {
      const r = [x, y, 1];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) A[i][j] += r[i] * r[j];
        bx[i] += r[i] * tx;
        by[i] += r[i] * ty;
      }
    }
    const px = solve3(A, bx), py = solve3(A, by);
    return px && py ? [...px, ...py] : null;
  }

  // --- the smoothing ---------------------------------------------------------

  // Slider 0..10 -> One Euro parameters in viewport-fractions and seconds.
  // minCutoff is the cut-off frequency while still (lower = steadier); beta
  // raises it with speed so a swing is followed at once.
  function filterParams(level) {
    if (!(level > 0)) return null;
    const t = Math.min(level, 10) / 10;
    return { minCutoff: Math.pow(10, Math.log10(6) + t * (Math.log10(0.35) - Math.log10(6))), beta: 4, dCutoff: 1 };
  }

  function lowPass(prev, x, alpha) { return prev + alpha * (x - prev); }
  function alphaFor(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }

  class OneEuro {
    constructor(params) { this.params = params; this.reset(); }
    reset() { this.x = null; this.dx = 0; this.t = 0; }
    filter(x, t) {
      if (this.x === null) { this.x = x; this.t = t; this.dx = 0; return x; }
      if (!(t > this.t)) return this.x;     // the same moment again (pointer + mouse event): no new information
      const dt = Math.min((t - this.t) / 1000, 0.5);
      this.t = t;
      const { minCutoff, beta, dCutoff } = this.params;
      this.dx = lowPass(this.dx, (x - this.x) / dt, alphaFor(dCutoff, dt));
      this.x = lowPass(this.x, x, alphaFor(minCutoff + beta * Math.abs(this.dx), dt));
      return this.x;
    }
  }

  // Corrects and smooths a stream of positions (fractions of the viewport).
  class Pipeline {
    constructor(profile) {
      this.affine = profile.affine || IDENTITY;
      const p = filterParams(profile.smoothing);
      this.fx = p ? new OneEuro(p) : null;
      this.fy = p ? new OneEuro(p) : null;
    }
    reset() { if (this.fx) { this.fx.reset(); this.fy.reset(); } }
    // correct: apply the affine (the caller says whether it holds, i.e. fullscreen)
    push(x, y, t, correct = true) {
      if (x <= EDGE || x >= 1 - EDGE || y <= EDGE || y >= 1 - EDGE) {
        this.reset();                        // off-screen: the engine reads the edge as reload
        return [x, y];
      }
      let [cx, cy] = correct ? applyAffine(this.affine, x, y) : [x, y];
      if (this.fx) { cx = this.fx.filter(cx, t); cy = this.fy.filter(cy, t); }
      // keep a corrected aim on the picture: only a real off-screen aim may reach the edge
      return [Math.min(Math.max(cx, EDGE * 2), 1 - EDGE * 2), Math.min(Math.max(cy, EDGE * 2), 1 - EDGE * 2)];
    }
  }

  // --- the picture and its border ---------------------------------------------
  //
  // Fullscreen, every game shows its original 4:3 picture centred on the screen
  // (a 4:3 canvas under the browser's object-fit: contain), and the light-gun
  // border runs round that 4:3 box, not the screen: the gun's driver maps the
  // border's outer edge to the whole screen, so a position the gun reports as a
  // fraction of the screen is that fraction of the box, which is exactly how the
  // games read a fullscreen canvas (by its full element rect). The picture sits
  // inside the border and its gap, filling the box they leave (lib/cabinet.js).

  // The 4:3 box centred in a W x H screen.
  function box(W, H, aspect = ASPECT) {
    const w = Math.min(W, H * aspect), h = w / aspect;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  // The border's thickness in pixels for a bordered area of W x H: pct of the
  // short edge, rounded down (the engine's rule).
  function borderPx(W, H, pct) {
    return pct > 0 ? Math.floor(pct * Math.min(W, H) / 100) : 0;
  }

  // The black gap between the white border and the picture, in whole % (0 = none). The
  // camera finds the border by brightness: a bright scene touching it (TC2 past the first
  // area) merges with the band, its inner edge is lost and the aim freezes. Black beside
  // the band keeps it apart. Border + gap stays within the engines' 6 % limit.
  const MAX_BORDER = 6;
  function innerGap(borderPct, profile) {
    const b = Math.round(borderPct);
    return b > 0 ? Math.max(0, Math.min(Math.round(profile.gapPct || 0), MAX_BORDER - b)) : 0;
  }

  // The picture's rectangle inside a W x H bordered area: the largest centred
  // 4:3 rectangle within the border (and the gap inside it), in whole pixels.
  function pictureRect(W, H, pct, aspect = ASPECT, gapPct = 0) {
    const b = borderPx(W, H, pct), inner = gapPct > 0 ? borderPx(W, H, pct + gapPct) : b;
    const ow = W - 2 * inner, oh = H - 2 * inner;
    let w, h;
    if (ow <= oh * aspect) { w = ow; h = Math.round(ow / aspect); }
    else { h = oh; w = Math.round(oh * aspect); }
    return { x: inner + Math.floor((ow - w) / 2), y: inner + Math.floor((oh - h) / 2), w, h, border: b };
  }

  // --- the engine's config -----------------------------------------------------

  // Set `key = value` lines in an eng_cfg-style file (text), keeping the rest.
  function patchCfg(text, values) {
    const lines = (text || '').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const [key, value] of Object.entries(values)) {
      const re = new RegExp('^\\s*' + key + '\\s*=');
      const i = lines.findIndex(l => re.test(l));
      if (i >= 0) lines[i] = `${key} = ${value}`;
      else lines.push(`${key} = ${value}`);
    }
    return lines.join('\n') + '\n';
  }

  // What the profile asks of the engine; {} when the profile is off.
  //
  // aspect = stretch, widescreen = 0: the Time Crisis engine draws its border
  // hugging the picture, and keeping the picture 4:3 inside a border of equal
  // thickness all round leaves the white frame narrower than 4:3 (1412 x 1080
  // in a 1440 x 1080 box). The gun's driver solves the frame as 4:3, so its aim
  // was squeezed. Stretch fills the space inside the border instead: the frame
  // is the whole 4:3 canvas, as on the calibration page and in HotD2, and the
  // picture is ~2 % wider than 4:3. On a 4:3 canvas widescreen changes nothing
  // but would bring back the 4:3 picture. Stretch needs a 4:3 canvas: the pages
  // fullscreen a wrapper that keeps it so, and the engine's own fullscreen (which
  // resizes the canvas to the screen) is switched off.
  //
  // key_pedal = Space: a gun without a pedal. The engines bind Space to the
  // trigger and Z to the pedal; with the gun's trigger firing, Space is the
  // pedal (hold it to come out of cover) and the trigger's keyboard key is its
  // alternate, Return. The keys are SDL scancode names.
  function engineValues(profile) {
    if (!profile.enabled) return {};
    return {
      // the page draws border + gap round the canvas (lib/cabinet.js): the engine draws none
      gun_border: 0, crosshair: profile.crosshair ? 1 : 0,
      aspect: 'stretch', widescreen: 0,
      window_mode: 0, fullscreen: 0,     // the page's fullscreen, never the engine's (that one is 16:9)
      key_pedal: 'Space', key_trigger: 'Return',
    };
  }

  // --- installing on a game page -----------------------------------------------

  const MOUSE = ['mousemove', 'mousedown', 'mouseup', 'click', 'dblclick'];
  const POINTER = ['pointermove', 'pointerdown', 'pointerup'];   // some engines (HotD2) read these instead
  const HOVER = ['mouseenter', 'mouseleave', 'mouseover', 'mouseout', 'pointerenter', 'pointerleave', 'pointerover', 'pointerout'];

  // Fullscreen is either the canvas itself (HotD2) or a wrapper round it that keeps the
  // canvas 4:3 (the Time Crisis pages: SDL resizes a fullscreen canvas to the whole screen).
  const fullscreenOf = (canvas) => {
    const f = document.fullscreenElement;
    return f && (f === canvas || f.contains(canvas)) ? f : null;
  };

  // Route the canvas's mouse events through the profile. Install BEFORE the
  // engine boots so this capture listener runs ahead of SDL's.
  //
  // opts.frame: the element the gun's fraction maps to while fullscreen - the light
  // gun's frame round the canvas (Cabinet.frame), whose outer edge the driver maps
  // to the whole screen. Without it, the canvas itself.
  function install(canvas, profile = load(), opts = {}) {
    const frameEl = () => (opts.frame && opts.frame.isConnected ? opts.frame : canvas);
    const style = document.createElement('style');
    style.textContent =
      '#' + canvas.id + ':fullscreen, :fullscreen:has(#' + canvas.id + '), :fullscreen #' + canvas.id + ' { cursor: none !important; }' +
      (profile.enabled && profile.hideCursor ? '#' + canvas.id + ' { cursor: none !important; }' : '');
    document.head.appendChild(style);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    if (!profile.enabled) return null;

    const pipe = new Pipeline(profile);
    const ours = new WeakSet();
    let last = null;                          // the position the engine was last given, client px

    let lastIn = null;                        // the last raw move taken: [clientX, clientY, time]

    const handler = (e) => {
      if (ours.has(e)) return;
      const fs = fullscreenOf(canvas), full = !!fs;
      // in a fullscreen wrapper the gun can point at the black either side of the canvas:
      // those events are the gun's too
      if (e.target !== canvas && !(fs && fs.contains(e.target))) return;
      const vw = innerWidth, vh = innerHeight;
      let cx, cy;
      const move = e.type === 'mousemove' || e.type === 'pointermove';
      // a pointermove and its mousemove carry the same position: filter it once
      const repeat = lastIn && lastIn[0] === e.clientX && lastIn[1] === e.clientY && Math.abs(e.timeStamp - lastIn[2]) < 20;
      if ((move && !repeat) || !last) {
        const [x, y] = pipe.push(e.clientX / vw, e.clientY / vh, e.timeStamp, full);
        // the driver maps the border's outer edge (the frame round the canvas) to the whole
        // screen, so fullscreen the fraction is a fraction of the frame; windowed, of the viewport
        const r = full ? frameEl().getBoundingClientRect() : { left: 0, top: 0, width: vw, height: vh };
        cx = r.left + x * r.width; cy = r.top + y * r.height;
        last = [cx, cy];
        lastIn = [e.clientX, e.clientY, e.timeStamp];
      } else {
        [cx, cy] = last;                      // a press lands where the smoothed aim is
      }
      // not preventDefault: a press must still focus the canvas (keyboard input)
      e.stopImmediatePropagation();
      const init = {
        bubbles: true, cancelable: true, composed: true, view: window, detail: e.detail,
        screenX: e.screenX + (cx - e.clientX), screenY: e.screenY + (cy - e.clientY),
        clientX: cx, clientY: cy, movementX: e.movementX, movementY: e.movementY,
        button: e.button, buttons: e.buttons, relatedTarget: e.relatedTarget,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
      };
      const out = e.type.startsWith('pointer')
        ? new PointerEvent(e.type, Object.assign(init, {
            pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary,
            width: e.width, height: e.height, pressure: e.pressure,
          }))
        : new MouseEvent(e.type, init);
      ours.add(out);
      canvas.dispatchEvent(out);
    };
    for (const type of [...MOUSE, ...POINTER]) window.addEventListener(type, handler, true);
    // Fullscreen in a wrapper the real pointer wanders over the black either side, which
    // would tell the engine the mouse left its window (SDL then reads every aim as off-screen).
    // Keep those from the canvas while fullscreen, and say the mouse is in when it starts.
    const hover = (e) => {
      if (ours.has(e) || !fullscreenOf(canvas)) return;
      if (e.target === canvas || e.relatedTarget === canvas || (e.target && e.target.contains && e.target.contains(canvas))) e.stopImmediatePropagation();
    };
    for (const type of HOVER) window.addEventListener(type, hover, true);
    document.addEventListener('fullscreenchange', () => {
      pipe.reset(); last = null;
      if (fullscreenOf(canvas)) {
        for (const type of ['mouseover', 'mouseenter']) {
          const ev = new MouseEvent(type, { bubbles: type === 'mouseover', view: window, clientX: innerWidth / 2, clientY: innerHeight / 2 });
          ours.add(ev); canvas.dispatchEvent(ev);
        }
      }
    });
    return { profile, pipe };
  }

  return {
    KEY, IDENTITY, EDGE, ASPECT, defaults, load, save, box, borderPx, pictureRect,
    applyAffine, fitAffine, filterParams, OneEuro, Pipeline,
    innerGap, patchCfg, engineValues, install,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SindenAim;
