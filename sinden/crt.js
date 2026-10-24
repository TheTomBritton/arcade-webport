// A CRT look for the game pages: scanlines, a phosphor mask, a touch of horizontal
// softness and a dimmer picture. A second canvas sits exactly over the game's canvas
// (pointer-events: none, so the gun's events still reach the game) and copies it
// every frame through a fragment shader.
//
// Geometry is untouched: no curvature, no overscan. The gun's aim is mapped to the
// picture's rectangle (sinden/aim.js) and must stay so. The light-gun border is
// passed through exactly as the engine drew it and the gap inside it is painted
// black, so the camera sees the same white band on a dimmer picture, which is more
// contrast for the tracker, not less.
//
// F9 cycles: off, then on at 100 / 85 / 70 / 55 % picture brightness. The choice is
// saved in the calibration profile (profile.crt), so it holds across games.
//
// v2: the border is painted solid white (and its gap solid black) in the overlay, on top of
// the effect, instead of being resampled from the game's pixels; the scanline pitch follows
// the picture's size on screen, so a windowed picture no longer aliases.
//
// v3: the light gun's frame is the page's, round the canvas (lib/cabinet.js), so the view
// normally covers the whole canvas: layout may be null. install() takes { deferred } (the
// view stays hidden until start() - the game is not drawing yet), { onChange } and a
// cycle() for a button to do what F9 does.
//
// v4: scanlines are a whole number of screen pixels tall. At 480 lines on a 1080p panel
// the old pitch was ~2.1 px, and a cosine at that pitch beats against the pixel grid into
// broad bright and dark bands. Each scanline is now `pitch` rows of screen pixels, sampled
// once at its centre (a beam), brightest on its middle row and dark in the gap. The
// resolution is a setting (profile.crt.lines, 0 = the game's native lines, install()'s
// opts.lines): the pitch is the whole number of pixels nearest picture height / lines, at
// least 2, so the count actually drawn depends on the picture's size and lines() says it.
// Shift+F9 steps through STOPS; the cabinet panel has a fader for it.
'use strict';

const SindenCrt = (() => {

  const LEVELS = [100, 85, 70, 55];        // picture brightness steps, percent
  const LINES = 480;                       // native lines when a page does not say (opts.lines)
  // The resolution settings, 0 = native. Spaced so neighbours land on different whole-pixel
  // pitches at the sizes that matter (a 1080p picture: 158, 190, 238, 317, 475 lines).
  const STOPS = [0, 160, 192, 240, 320, 480];

  const VS = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }';
  const FS = `precision mediump float;
uniform sampler2D tex;
uniform vec2 size;                 // the view, px (the on-screen size: scanlines and mask are drawn in screen pixels)
uniform vec4 pic;                  // the picture: x, y, w, h (view px, top-left origin)
uniform vec4 frame;                // inside the white border: x, y, w, h; the ring between it and pic is black
uniform float pitch, scan, mask, dx, bright;   // pitch: screen px per scanline (whole); dx: horizontal softness, texture units
uniform float border;              // 1 when a light-gun border is on: outside the frame is painted solid white
void main() {
  vec2 p = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
  vec2 uv = p / size;
  bool inPic = p.x >= pic.x && p.x < pic.x + pic.z && p.y >= pic.y && p.y < pic.y + pic.w;
  if (!inPic) {
    bool inFrame = p.x >= frame.x && p.x < frame.x + frame.z && p.y >= frame.y && p.y < frame.y + frame.w;
    // The border sits on top of the effect: pure white, never dimmed, striped or resampled,
    // and the gap inside it pure black - the camera's tracker sees exactly the band it needs.
    gl_FragColor = inFrame ? vec4(0.0, 0.0, 0.0, 1.0) : (border > 0.5 ? vec4(1.0) : texture2D(tex, uv));
    return;
  }
  // Which scanline this pixel row is in, counted in whole screen pixels from the picture's
  // top, and the row within it. The line is sampled once, at its centre: a beam.
  float ry = floor(p.y - pic.y);
  float line = floor(ry / pitch), j = ry - line * pitch;
  vec2 st = vec2(uv.x, (pic.y + (line + 0.5) * pitch) / size.y);
  vec3 c = 0.5 * texture2D(tex, st).rgb
         + 0.25 * (texture2D(tex, st - vec2(dx, 0.0)).rgb + texture2D(tex, st + vec2(dx, 0.0)).rgb);
  // The beam's profile across the line: full on its centre row, falling off towards the gap.
  float d = abs(j - floor((pitch - 1.0) * 0.5)) / (pitch * 0.5);
  float sl = 1.0 - scan * (1.0 - exp(-2.2 * d * d));
  float col = mod(gl_FragCoord.x, 3.0);
  vec3 m = 1.0 - mask * vec3(col < 1.0 ? 0.0 : 1.0, (col >= 1.0 && col < 2.0) ? 0.0 : 1.0, col >= 2.0 ? 0.0 : 1.0);
  gl_FragColor = vec4(c * sl * m * bright, 1.0);
}`;

  function settings(profile) {
    return Object.assign({ enabled: false, brightness: 100, scanlines: 50, mask: 20, blur: 50, lines: 0 }, profile.crt || {});
  }

  // The state F9 moves to: off -> 100 -> 85 -> 70 -> 55 -> off.
  function next(crt) {
    if (!crt.enabled) return Object.assign({}, crt, { enabled: true, brightness: LEVELS[0] });
    const i = LEVELS.indexOf(crt.brightness);
    return i < 0 || i === LEVELS.length - 1
      ? Object.assign({}, crt, { enabled: false })
      : Object.assign({}, crt, { brightness: LEVELS[i + 1] });
  }

  // The scanline pitch for a picture `h` screen px tall: whole pixels, at least 2.
  const pitchFor = (h, lines) => Math.max(2, Math.round(h / lines));

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  // Draw a CRT view of `canvas` over it. layout(W, H) -> { picture: [x, y, w, h], frame: [x, y, w, h] }
  // in buffer pixels: the picture gets the effect, the ring between frame and picture is black,
  // the rest (the white border) is copied; null = the whole canvas is the picture (the frame is
  // the page's). Returns null when WebGL is unavailable.
  function install(canvas, profile, layout, opts = {}) {
    if (!layout) layout = (W, H) => ({ picture: [0, 0, W, H], frame: [0, 0, W, H] });
    const host = canvas.parentElement;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const el = document.createElement('canvas');
    el.className = 'sinden-crt';
    el.style.cssText = 'position:absolute;pointer-events:none;display:none;background:#000';
    host.appendChild(el);
    const gl = el.getContext('webgl', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false });
    if (!gl) { el.remove(); return null; }
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { el.remove(); return null; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const u = {};
    for (const n of ['size', 'pic', 'frame', 'pitch', 'scan', 'mask', 'dx', 'bright', 'border']) u[n] = gl.getUniformLocation(prog, n);

    const native = opts.lines || LINES;
    let crt = settings(profile);
    let shown = 0;                           // the line count last drawn, to tell the panel when it moves
    let running = false;
    let armed = !opts.deferred;              // deferred: nothing to look at until the game draws

    // Keep the view over the canvas: same place and size within the host.
    const place = () => {
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) return;
      const cr = canvas.getBoundingClientRect(), hr = host.getBoundingClientRect();
      Object.assign(el.style, {
        left: cr.left - hr.left - host.clientLeft + canvas.clientLeft + 'px',
        top: cr.top - hr.top - host.clientTop + canvas.clientTop + 'px',
        width: cw + 'px', height: ch + 'px',
      });
    };

    // The view renders at its on-screen size (the engine's buffer may be smaller, or larger,
    // than the screen): scanlines and the mask are screen-pixel patterns, and would alias
    // if drawn at the buffer's size and scaled.
    const draw = () => {
      const W = canvas.width, H = canvas.height, dpr = window.devicePixelRatio || 1;
      const VW = Math.round(canvas.clientWidth * dpr), VH = Math.round(canvas.clientHeight * dpr);
      if (!W || !H || !VW || !VH) return;
      if (el.width !== VW || el.height !== VH) { el.width = VW; el.height = VH; gl.viewport(0, 0, VW, VH); }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      const l = layout(W, H), sx = VW / W, sy = VH / H;
      const scale = (r) => [r[0] * sx, r[1] * sy, r[2] * sx, r[3] * sy];
      const picture = scale(l.picture), frame = scale(l.frame);
      // Whole-pixel scanlines never alias, at any size: a small windowed picture just gets
      // fewer of them (the pitch never drops under 2).
      const pitch = pitchFor(picture[3], crt.lines || native);
      const drawn = Math.round(picture[3] / pitch);
      if (drawn !== shown) { shown = drawn; if (opts.onChange) opts.onChange(crt); }
      const scan = crt.scanlines / 100;
      // The mask is a 3-pixel pattern: at small sizes it is just a tint, so ease it out.
      const mask = (crt.mask / 100) * Math.min(1, Math.max(0, (picture[3] / native - 0.75) / 0.75));
      gl.uniform2f(u.size, VW, VH);
      gl.uniform4fv(u.pic, [Math.round(picture[0]), Math.round(picture[1]), picture[2], picture[3]]);
      gl.uniform4fv(u.frame, frame);
      gl.uniform1f(u.pitch, pitch);
      gl.uniform1f(u.scan, scan);
      gl.uniform1f(u.mask, mask);
      gl.uniform1f(u.border, (frame[0] > 0.5 || frame[1] > 0.5) ? 1 : 0);
      gl.uniform1f(u.dx, (crt.blur / 100) * 0.6 * (l.picture[2] / (native * 4 / 3)) / W);   // 0.6 of a native pixel at full
      gl.uniform1f(u.bright, crt.brightness / 100);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = () => {
      if (!running) return;
      if (!document.hidden) { place(); draw(); }
      requestAnimationFrame(loop);
    };

    const apply = () => {
      const on = crt.enabled && armed;
      el.style.display = on ? 'block' : 'none';
      if (on && !running) { running = true; requestAnimationFrame(loop); }
      if (!on) running = false;
    };

    // A short notice inside the host (visible fullscreen too).
    let toast = null, toastTimer = 0;
    const say = (text) => {
      if (!toast) {
        toast = document.createElement('div');
        toast.style.cssText = 'position:absolute;left:12px;top:12px;padding:6px 10px;background:rgba(0,0,0,.7);color:#fff;' +
          'font:14px system-ui,sans-serif;border-radius:4px;pointer-events:none;z-index:2;display:none';
        host.appendChild(toast);
      }
      toast.textContent = text; toast.style.display = 'block';
      clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 1500);
      if (opts.status) opts.status(text);
    };

    const set = (c) => {
      crt = Object.assign(settings(profile), c);
      profile.crt = crt;
      if (typeof SindenAim !== 'undefined') SindenAim.save(profile);
      apply();
      if (opts.onChange) opts.onChange(crt);
    };
    const text = () => (crt.enabled ? `${crt.brightness} %` : 'OFF');
    // The scanlines drawn at the picture's present size (the view's height, device px).
    const lines = () => {
      const h = Math.round(canvas.clientHeight * (window.devicePixelRatio || 1));
      return h ? Math.round(h / pitchFor(h, crt.lines || native)) : 0;
    };
    const linesText = () => (crt.lines ? String(lines()) : 'AUTO');
    // The resolution as a stop index (STOPS), for the fader and Shift+F9.
    const stop = () => Math.max(0, STOPS.indexOf(crt.lines));
    const setStop = (i, quiet) => {
      i = Math.max(0, Math.min(STOPS.length - 1, Math.round(i)));
      if (STOPS[i] === crt.lines) return;
      set({ lines: STOPS[i] });
      if (!quiet) say(`CRT ${crt.lines ? lines() + ' lines' : 'lines: native (' + lines() + ')'}`);
    };
    // what F9 does: off -> 100 -> 85 -> 70 -> 55 -> off, with the notice
    const cycle = () => {
      set(next(crt));
      say(crt.enabled ? `CRT on, picture ${crt.brightness} %` : 'CRT off');
    };
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F9') return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.shiftKey) setStop((stop() + 1) % STOPS.length);   // Shift+F9: the next resolution
      else cycle();
    }, true);
    window.addEventListener('keyup', (e) => { if (e.code === 'F9') { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    addEventListener('resize', place);
    document.addEventListener('fullscreenchange', () => setTimeout(place, 50));
    apply();
    return { el, set, get: () => crt, draw, cycle, text, lines, linesText, stop, setStop, native, start: () => { armed = true; apply(); } };
  }

  return { LEVELS, LINES, STOPS, settings, next, pitchFor, install };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SindenCrt;
