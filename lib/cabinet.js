// The cabinet: what every machine in the arcade shares around its engine.
//
//   Cabinet.frame(screen, canvas, profile)   the light gun's frame: a white border
//       and a black gap inside it, drawn by the PAGE round the engine's canvas. The
//       engines draw their whole picture into the canvas and never inset it, so no
//       engine clips its own picture, every game's border is the same, and the CRT
//       look (sinden/crt.js), which covers only the canvas, always sits under it.
//       F8 and the panel's button cycle it 0..6 % of the 4:3 box's short edge,
//       starting from the calibration suite's profile (../calibrate/).
//
//   Cabinet.panel(host, spec)   the control panel under the screen: power, coin,
//       start, the service switches, the display controls and the gun, as the
//       buttons of a cabinet. Every function a key reaches is a button here too.
//
//   Cabinet.tapKey(target, code)   a key press for the engines that read the
//       keyboard (SDL): keydown, held a few frames, keyup.
//
// The frame's geometry is the one the engines used (sinden/aim.js borderPx and
// innerGap): the gun's driver maps the white border's outer edge to the whole
// screen, so the border runs round the 4:3 box and the picture fills the box
// inside border and gap.
'use strict';

const Cabinet = (() => {

  const CSS = `
.cab-screen { position: relative; width: 100%; aspect-ratio: 4 / 3; background: #000; box-sizing: border-box;
  border: 1px solid var(--edge, #1c3a1c); border-radius: 4px; overflow: hidden; }
.cab-screen:fullscreen { border: 0; border-radius: 0; aspect-ratio: auto; width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center; background: #000; }
/* fullscreen the box stays 4:3, centred, black either side (or above and below) */
.cab-screen:fullscreen > .cab-frame { width: min(100%, calc(100vh * 4 / 3)); height: auto; aspect-ratio: 4 / 3; }
.cab-frame { position: relative; width: 100%; height: 100%; box-sizing: border-box; background: #000; padding: 0; }
.cab-frame.on { background: #fff; }
.cab-gap { position: relative; width: 100%; height: 100%; box-sizing: border-box; background: #000; padding: 0; }
.cab-gap > .cab-picture { display: block; width: 100% !important; height: 100% !important; border: 0 !important; border-radius: 0 !important;
  background: #000; image-rendering: auto; box-sizing: border-box; }

.cab { position: relative; margin: 12px auto 0; padding: 16px 22px 14px; border-radius: 8px; box-sizing: border-box;
  background:
    repeating-linear-gradient(90deg, rgba(255,255,255,.028) 0 1px, transparent 1px 3px),
    linear-gradient(180deg, #33363e 0%, #1e2026 48%, #15161a 100%);
  border: 1px solid #08090b;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.14), inset 0 -1px 0 rgba(0,0,0,.7), 0 12px 26px rgba(0,0,0,.55);
  display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-start; gap: 14px 26px;
  font-family: var(--mono, ui-monospace, Menlo, monospace); text-align: center; }
.cab-screw { position: absolute; width: 9px; height: 9px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #9ea3ab, #5a5e66 60%, #2b2d33 100%);
  box-shadow: 0 1px 1px rgba(255,255,255,.18), inset 0 -1px 1px rgba(0,0,0,.6); }
.cab-screw::after { content: ""; position: absolute; left: 1px; right: 1px; top: 50%; height: 1px; margin-top: -1px;
  background: #1a1b1f; transform: rotate(var(--r, 25deg)); }
.cab-screw.tl { left: 7px; top: 7px; } .cab-screw.tr { right: 7px; top: 7px; --r: -40deg; }
.cab-screw.bl { left: 7px; bottom: 7px; --r: 70deg; } .cab-screw.br { right: 7px; bottom: 7px; --r: 10deg; }
.cab-group { display: flex; flex-direction: column; align-items: center; gap: 9px; min-width: 84px; }
.cab-group-label { font: 600 10px/1 var(--mono, ui-monospace, Menlo, monospace); letter-spacing: .3em; text-transform: uppercase;
  color: #9aa0a8; text-shadow: 0 1px 0 rgba(255,255,255,.07), 0 -1px 0 #000; padding-bottom: 6px; width: 100%;
  border-bottom: 1px solid rgba(0,0,0,.6); box-shadow: 0 1px 0 rgba(255,255,255,.06); }
.cab-row { display: flex; gap: 12px 14px; align-items: flex-start; justify-content: center; flex-wrap: wrap; }
.cab .cab-btn, .cab .cab-btn:hover { appearance: none; border: 0; margin: 0; padding: 0; background: none; cursor: pointer; text-decoration: none;
  font: 400 10px/1 var(--mono, ui-monospace, Menlo, monospace); letter-spacing: 0; color: #e4e6ea; border-radius: 0; box-shadow: none;
  display: flex; flex-direction: column; align-items: center; gap: 6px; -webkit-tap-highlight-color: transparent; transition: none; }
.cab .cab-btn:focus-visible .cab-cap { outline: 2px solid #ffb039; outline-offset: 3px; }
.cab .cab-btn:not(:disabled):hover .cab-cap { filter: brightness(1.12); }
.cab .cab-btn:disabled { cursor: default; background: none; border: 0; color: #e4e6ea; }
.cab .cab-btn:disabled .cab-cap { filter: saturate(.35) brightness(.7); }
.cab .cab-btn:disabled .cab-name, .cab .cab-btn:disabled kbd { opacity: .5; }
.cab-name { display: block; font: 700 10px/1.15 var(--mono, ui-monospace, Menlo, monospace); letter-spacing: .14em; text-transform: uppercase;
  color: #d9dce1; text-shadow: 0 1px 0 #000; white-space: nowrap; }
.cab .cab-btn kbd { font: 500 9.5px/1 var(--mono, ui-monospace, Menlo, monospace); color: #8a9099; background: #0c0d10;
  border: 1px solid #2b2e36; border-bottom-width: 2px; border-radius: 3px; padding: 2px 5px; white-space: nowrap; }
.cab-cap { display: block; position: relative; box-sizing: border-box; transition: transform .06s ease, box-shadow .06s ease; }

/* a round arcade button */
.cab-round .cab-cap { width: 50px; height: 50px; border-radius: 50%;
  background: radial-gradient(circle at 38% 30%, var(--hi), var(--mid) 44%, var(--lo) 100%);
  box-shadow: 0 0 0 3px #0e0f12, 0 0 0 6px #3b3e46, 0 0 0 7px #0a0b0d, 0 7px 12px rgba(0,0,0,.6),
    inset 0 -5px 8px rgba(0,0,0,.38), inset 0 3px 4px rgba(255,255,255,.45); }
.cab .cab-round:not(:disabled):active .cab-cap { transform: translateY(2px);
  box-shadow: 0 0 0 3px #0e0f12, 0 0 0 6px #3b3e46, 0 0 0 7px #0a0b0d, 0 3px 5px rgba(0,0,0,.6),
    inset 0 -2px 4px rgba(0,0,0,.4), inset 0 2px 3px rgba(255,255,255,.3); }
.cab-small .cab-cap { width: 32px; height: 32px; }
.cab-red { --hi: #ff9a9a; --mid: #d61220; --lo: #66060c; }
.cab-white { --hi: #ffffff; --mid: #d8dadf; --lo: #7f838b; }
.cab-blue { --hi: #9ec8ff; --mid: #1f6fd6; --lo: #0b2f66; }
.cab-yellow { --hi: #fff1a8; --mid: #f0b514; --lo: #7a5607; }
.cab-green { --hi: #b8ffb8; --mid: #22b14c; --lo: #0b4d20; }

/* the power switch: a lamp that lights once the machine is on */
.cab-power .cab-cap { width: 96px; height: 50px; border-radius: 6px; display: grid; place-items: center;
  background: linear-gradient(#3c3f48, #202229 60%, #1a1b20);
  box-shadow: 0 0 0 2px #0a0b0d, 0 0 0 3px #3b3e46, 0 6px 10px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.22), inset 0 -3px 6px rgba(0,0,0,.6); }
.cab-power .cab-cap::before { content: ""; width: 14px; height: 14px; border-radius: 50%; background: #2a3a2a;
  box-shadow: inset 0 1px 3px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.12); }
.cab-power.lit .cab-cap::before { background: radial-gradient(circle at 40% 35%, #d8ffd8, #37e06a 50%, #0f7a32);
  box-shadow: 0 0 10px 3px rgba(70,230,110,.65), inset 0 -1px 2px rgba(0,0,0,.4); }
.cab .cab-power:not(:disabled):active .cab-cap { transform: translateY(2px); box-shadow: 0 0 0 2px #0a0b0d, 0 0 0 3px #3b3e46, 0 3px 5px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.15); }

/* the coin door: a chrome plate with the slot */
.cab-coin .cab-cap { width: 60px; height: 50px; border-radius: 5px; display: grid; place-items: center;
  background: linear-gradient(168deg, #f6f6f8 0%, #bfc1c7 32%, #8e9198 50%, #d6d7db 68%, #9ea0a7 100%);
  box-shadow: 0 0 0 2px #0a0b0d, 0 0 0 3px #4a4d55, 0 6px 10px rgba(0,0,0,.6), inset 0 1px 0 #fff, inset 0 -1px 0 rgba(0,0,0,.35); }
.cab-coin .cab-cap::before { content: ""; width: 7px; height: 28px; border-radius: 3px; background: #050506;
  box-shadow: inset 0 0 0 1px #26272b, 0 1px 0 rgba(255,255,255,.7); }
.cab .cab-coin:not(:disabled):active .cab-cap { transform: translateY(2px); box-shadow: 0 0 0 2px #0a0b0d, 0 0 0 3px #4a4d55, 0 3px 5px rgba(0,0,0,.6), inset 0 1px 0 #fff; }

/* a rubber key, with an amber readout for the settings */
.cab-key .cab-cap { min-width: 96px; height: 42px; border-radius: 5px; display: grid; place-items: center; padding: 0 10px; box-sizing: border-box;
  background: linear-gradient(#30333b, #1c1e24);
  box-shadow: 0 0 0 1px #0a0b0d, 0 3px 0 #0d0e11, 0 6px 9px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.15); }
.cab .cab-key:not(:disabled):active .cab-cap { transform: translateY(2px);
  box-shadow: 0 0 0 1px #0a0b0d, 0 1px 0 #0d0e11, 0 2px 4px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.1); }
.cab-key.cab-narrow .cab-cap { min-width: 64px; }
.cab-readout { font: 700 12.5px/1 var(--mono, ui-monospace, Menlo, monospace); letter-spacing: .08em; color: #ffb039;
  text-shadow: 0 0 7px rgba(255,165,40,.85), 0 0 1px #fff3d6; background: #0a0806; border-radius: 3px; padding: 5px 8px; min-width: 3.4em;
  box-shadow: inset 0 1px 3px #000, 0 0 0 1px #2a2420; }
.cab-readout.off { color: #5c4a2d; text-shadow: none; }
.cab-key .cab-text { font: 700 10.5px/1 var(--mono, ui-monospace, Menlo, monospace); letter-spacing: .14em; text-transform: uppercase; color: #cfd3d9;
  text-shadow: 0 1px 0 #000; }
/* a slide fader: a slot in the panel with a scale, a knurled cap riding in it, and the amber
   readout over it. Keyboard (arrows, Home/End) and pointer (click or drag along the slot). */
.cab-fader { display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; outline: none;
  -webkit-tap-highlight-color: transparent; touch-action: none; user-select: none; }
.cab-fader .cab-face { display: flex; flex-direction: column; align-items: center; gap: 5px; box-sizing: border-box;
  width: 156px; height: 42px; padding: 4px 12px 0; border-radius: 5px; background: linear-gradient(#24262c, #17181c);
  box-shadow: 0 0 0 1px #0a0b0d, inset 0 1px 0 rgba(255,255,255,.08), inset 0 -1px 0 rgba(0,0,0,.6); }
.cab-fader .cab-readout { padding: 2px 6px; font-size: 11px; min-width: 3.6em; }
.cab-track { position: relative; width: 100%; height: 14px; }
.cab-track::before { content: ""; position: absolute; left: 0; right: 0; top: 5px; height: 4px; border-radius: 2px; background: #050506;
  box-shadow: inset 0 1px 2px #000, 0 1px 0 rgba(255,255,255,.1); }
.cab-tick { position: absolute; top: 11px; width: 1px; height: 3px; background: #5a5e66; margin-left: -.5px; }
.cab-knob { position: absolute; top: 0; width: 14px; height: 14px; margin-left: -7px; border-radius: 2px; box-sizing: border-box;
  background: repeating-linear-gradient(90deg, #d8dadf 0 1px, #7d818a 1px 2px), linear-gradient(#e9eaee, #8e9198);
  background-blend-mode: multiply; border: 1px solid #0a0b0d;
  box-shadow: 0 2px 3px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.6), inset 0 -1px 0 rgba(0,0,0,.4); }
.cab-knob::after { content: ""; position: absolute; left: 50%; top: 1px; bottom: 1px; width: 2px; margin-left: -1px; background: #ffb039;
  box-shadow: 0 0 3px rgba(255,165,40,.8); }
.cab-fader:focus-visible .cab-face { outline: 2px solid #ffb039; outline-offset: 3px; }
.cab-fader.disabled { cursor: default; }
.cab-fader.disabled .cab-face { filter: saturate(.35) brightness(.7); }
.cab-fader.disabled .cab-name, .cab-fader.disabled kbd { opacity: .5; }
.cab-fader kbd { font: 500 9.5px/1 var(--mono, ui-monospace, Menlo, monospace); color: #8a9099; background: #0c0d10;
  border: 1px solid #2b2e36; border-bottom-width: 2px; border-radius: 3px; padding: 2px 5px; white-space: nowrap; }
@media (max-width: 560px) { .cab { gap: 12px 16px; padding: 14px 14px 12px; } .cab-group { min-width: 0; } }
`;

  function style() {
    if (document.getElementById('cabinet-css')) return;
    const s = document.createElement('style');
    s.id = 'cabinet-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const aim = () => (typeof SindenAim !== 'undefined' ? SindenAim : null);
  const borderPx = (W, H, pct) => (aim() ? aim().borderPx(W, H, pct) : (pct > 0 ? Math.floor(pct * Math.min(W, H) / 100) : 0));
  const innerGap = (pct, profile) => (aim() ? aim().innerGap(pct, profile) : 0);
  const MAX = 6;

  // --- the frame -----------------------------------------------------------------
  //
  // screen: the 4:3 box the page fullscreens; canvas: the engine's, inside it. The
  // box becomes  screen > .cab-frame (white when on) > .cab-gap (black) > canvas.
  function frame(screen, canvas, profile, opts = {}) {
    style();
    screen.classList.add('cab-screen');
    const white = document.createElement('div');
    white.className = 'cab-frame';
    const gap = document.createElement('div');
    gap.className = 'cab-gap';
    canvas.classList.add('cab-picture');          /* the engine's canvas fills the gap (crt.js adds its own canvas beside it) */
    canvas.parentNode.insertBefore(white, canvas);
    white.appendChild(gap);
    gap.appendChild(canvas);
    let pct = profile && profile.enabled ? Math.max(0, Math.min(MAX, Math.round(profile.borderPct))) : 0;
    const listeners = [];
    const place = () => {
      const r = white.getBoundingClientRect();
      const W = Math.round(r.width), H = Math.round(r.height);
      if (!W || !H) return;
      const b = borderPx(W, H, pct), g = pct > 0 ? borderPx(W, H, pct + innerGap(pct, profile)) - b : 0;
      white.style.padding = b + 'px';
      gap.style.padding = g + 'px';
      white.classList.toggle('on', pct > 0);
    };
    const set = (n) => {
      n = Math.max(0, Math.min(MAX, Math.round(n)));
      const changed = n !== pct;
      pct = n;
      place();
      if (changed) for (const fn of listeners) fn(pct);
      return pct;
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(place).observe(white);
    addEventListener('resize', place);
    document.addEventListener('fullscreenchange', () => { place(); setTimeout(place, 60); });
    place();
    return {
      element: white, screen, canvas,
      get: () => pct,
      set,
      cycle: () => set((pct + 1) % (MAX + 1)),
      text: () => (pct ? pct + ' %' : 'OFF'),
      onChange: (fn) => listeners.push(fn),
      place,
    };
  }

  // --- a key press for an SDL engine ---------------------------------------------
  //
  // Dispatched on the canvas and bubbling: SDL listens on the canvas (Virtua Cop 2)
  // or the window (Time Crisis). SDL takes the scancode from `code` and the keycode
  // from `keyCode`; the engines sample once a frame, so the key is held a while.
  const KEYCODES = { Digit0: 48, Digit1: 49, Digit2: 50, Digit5: 53, Digit6: 54, Digit9: 57, Enter: 13, Escape: 27, Space: 32,
    F2: 113, F6: 117, F7: 118, F8: 119, F9: 120, F11: 122, PageUp: 33, PageDown: 34, Home: 36 };
  const KEYS = { Digit0: '0', Digit1: '1', Digit2: '2', Digit5: '5', Digit6: '6', Digit9: '9', Enter: 'Enter', Escape: 'Escape', Space: ' ' };
  function tapKey(target, code, hold = 120) {
    const init = { code, key: KEYS[code] || code, keyCode: KEYCODES[code] || 0, which: KEYCODES[code] || 0,
      bubbles: true, cancelable: true, composed: true };
    const down = new KeyboardEvent('keydown', init);
    down.cabinet = true;
    target.dispatchEvent(down);
    return new Promise((res) => setTimeout(() => {
      const up = new KeyboardEvent('keyup', init);
      up.cabinet = true;
      target.dispatchEvent(up);
      res();
    }, hold));
  }

  // --- the control panel -----------------------------------------------------------
  //
  // spec.groups: [{ label, rows: [[item, ...], ...] }]
  // item: { id, kind: 'power' | 'coin' | 'round' | 'key' | 'link' | 'fader', label, key (the keyboard hint),
  //         colour ('red' | 'white' | 'blue' | 'yellow' | 'green'), small, narrow, href, title,
  //         readout: () => text ('OFF' dims it), onClick, disabled }
  // a fader: { kind: 'fader', steps (positions 0..steps-1), value: () => position, onInput(position),
  //         active: () => usable (checked on refresh), readout, label, key, title }
  function panel(host, spec) {
    style();
    host.classList.add('cab');
    host.innerHTML = '';
    for (const c of ['tl', 'tr', 'bl', 'br']) {
      const s = document.createElement('span');
      s.className = 'cab-screw ' + c;
      s.setAttribute('aria-hidden', 'true');
      host.appendChild(s);
    }
    const items = new Map();
    for (const g of spec.groups) {
      const group = document.createElement('div');
      group.className = 'cab-group';
      const label = document.createElement('div');
      label.className = 'cab-group-label';
      label.textContent = g.label;
      group.appendChild(label);
      for (const row of g.rows) {
        const r = document.createElement('div');
        r.className = 'cab-row';
        for (const it of row) r.appendChild(build(it));
        group.appendChild(r);
      }
      host.appendChild(group);
    }
    function fader(it) {
      const el = document.createElement('div');
      el.className = 'cab-fader';
      el.tabIndex = 0;
      el.setAttribute('role', 'slider');
      el.setAttribute('aria-label', it.label);
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', String(it.steps - 1));
      if (it.id) el.id = it.id;
      if (it.title) el.title = it.title;
      const face = document.createElement('span');
      face.className = 'cab-face';
      const readout = document.createElement('span');
      readout.className = 'cab-readout';
      const track = document.createElement('span');
      track.className = 'cab-track';
      for (let i = 0; i < it.steps; i++) {
        const t = document.createElement('span');
        t.className = 'cab-tick';
        t.style.left = (100 * i / (it.steps - 1)) + '%';
        track.appendChild(t);
      }
      const knob = document.createElement('span');
      knob.className = 'cab-knob';
      track.appendChild(knob);
      face.append(readout, track);
      const name = document.createElement('span');
      name.className = 'cab-name';
      name.textContent = it.label;
      el.append(face, name);
      if (it.key) { const k = document.createElement('kbd'); k.textContent = it.key; el.appendChild(k); }
      let off = !!it.disabled;
      const put = (i) => { if (!off && i !== it.value()) { it.onInput(i); h.refresh(); } };
      const at = (x) => { const r = track.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * (it.steps - 1)); };
      el.addEventListener('pointerdown', (e) => {
        if (off || e.button !== 0) return;
        e.preventDefault(); el.focus({ preventScroll: true });
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        put(at(e.clientX));
      });
      el.addEventListener('pointermove', (e) => { if (!off && el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) put(at(e.clientX)); });
      el.addEventListener('keydown', (e) => {
        if (off) return;
        const v = it.value(), n = it.steps - 1;
        const to = { ArrowLeft: v - 1, ArrowDown: v - 1, ArrowRight: v + 1, ArrowUp: v + 1, Home: 0, End: n, PageDown: v - 1, PageUp: v + 1 }[e.code];
        if (to === undefined) return;
        e.preventDefault(); e.stopPropagation();
        put(Math.max(0, Math.min(n, to)));
      });
      const h = {
        el,
        enable: (on = true) => { off = !on; el.classList.toggle('disabled', off); el.setAttribute('aria-disabled', String(off)); el.tabIndex = off ? -1 : 0; },
        lit: () => {},
        refresh: () => {
          if (it.active) h.enable(!!it.active());
          const v = it.value(), t = it.readout ? String(it.readout()) : String(v);
          knob.style.left = (100 * v / (it.steps - 1)) + '%';
          readout.textContent = t;
          readout.classList.toggle('off', /^off$/i.test(t));
          el.setAttribute('aria-valuenow', String(v));
          el.setAttribute('aria-valuetext', t);
        },
      };
      h.enable(!off);
      h.refresh();
      if (it.id) items.set(it.id, h);
      return el;
    }
    function build(it) {
      if (it.kind === 'fader') return fader(it);
      const el = document.createElement(it.kind === 'link' ? 'a' : 'button');
      if (it.kind !== 'link') el.type = 'button';
      el.className = 'cab-btn cab-' + (it.kind === 'link' ? 'key' : it.kind) +
        (it.colour ? ' cab-' + it.colour : '') + (it.small ? ' cab-small' : '') + (it.narrow ? ' cab-narrow' : '');
      if (it.id) el.id = it.id;
      if (it.title) el.title = it.title;
      if (it.kind === 'link') el.href = it.href;
      const cap = document.createElement('span');
      cap.className = 'cab-cap';
      let readout = null;
      if (it.readout) {
        readout = document.createElement('span');
        readout.className = 'cab-readout';
        cap.appendChild(readout);
      } else if (it.kind === 'key' || it.kind === 'link') {
        const t = document.createElement('span');
        t.className = 'cab-text';
        t.textContent = it.label;
        cap.appendChild(t);
      }
      el.appendChild(cap);
      if (it.readout || (it.kind !== 'key' && it.kind !== 'link')) {
        const name = document.createElement('span');
        name.className = 'cab-name';
        name.textContent = it.label;
        el.appendChild(name);
      }
      if (it.key) {
        const k = document.createElement('kbd');
        k.textContent = it.key;
        el.appendChild(k);
      }
      if (it.disabled) el.disabled = true;
      if (it.onClick) el.addEventListener('click', (e) => { if (it.kind !== 'link') e.preventDefault(); it.onClick(e); });
      const h = {
        el,
        enable: (on = true) => { if (it.kind !== 'link') el.disabled = !on; },
        lit: (on = true) => el.classList.toggle('lit', !!on),
        refresh: () => {
          if (!readout) return;
          const t = String(it.readout());
          readout.textContent = t;
          readout.classList.toggle('off', /^off$/i.test(t));
        },
      };
      h.refresh();
      if (it.id) items.set(it.id, h);
      return el;
    }
    return {
      el: host,
      item: (id) => items.get(id),
      refresh: () => { for (const h of items.values()) h.refresh(); },
      enable: (ids, on = true) => { for (const id of ids) { const h = items.get(id); if (h) h.enable(on); } },
    };
  }

  // The page's fullscreen: the screen box, never the engine's own (which resizes the canvas).
  function fullscreen(screen) {
    if (document.fullscreenElement) return document.exitFullscreen();
    return screen.requestFullscreen().catch(() => {});
  }

  return { frame, panel, tapKey, fullscreen, MAX };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Cabinet;
