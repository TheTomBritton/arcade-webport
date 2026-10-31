// The House of the Dead (the 1998 Windows release, recompiled): the page's side of
// the machine. The engine (game/hotd1.js, sp00nznet/hotd-recomp on pcrecomp's
// win32hle, built for the browser) runs the game on a worker thread; it reads the
// game folder from game/data/ as it needs it, keeps its settings and scores in
// the browser's storage, hands every frame to the page (hotdPresent, WebGL),
// plays its sound through an AudioWorklet of its own, and asks the page to play
// the CD's music (hotdMusic). The light gun goes through the calibration suite's
// aim layer (../sinden/aim.js) and the mouse SDL already reads.
'use strict';

const $ = (id) => document.getElementById(id);
const status = (m) => { $('status').textContent = m; };

const ver = (await fetch('version.txt', { cache: 'no-store' }).then((r) => r.ok ? r.text() : '0').catch(() => '0')).trim();

/* ---- the CD music's state (the panel reads it as it is built) ---- */
let musicOn = localStorage.getItem('hotd1-music') !== 'off';
let musicEl = null, musicQueue = [], musicCur = 0;
let musicGain = 1;

/* ---- the cabinet: the light gun's frame (white border + black gap) is the PAGE's, round the
 * canvas (../lib/cabinet.js), as on every machine here. The SDL window is 1280x960, 4:3, so
 * the picture fills the box inside the frame; F8 and the panel cycle the border 0-6 % ---- */
const aimLayer = typeof SindenAim !== 'undefined' ? SindenAim : null;
const gunProfile = aimLayer ? aimLayer.load() : { enabled: false, borderPct: 0, gapPct: 0 };
const screen = $('screen');
const canvas = $('canvas');
const frame = Cabinet.frame(screen, canvas, gunProfile);
// the presenter: the page's WebGL canvas over SDL's (which keeps the input), the same size
const present = document.createElement('canvas');
present.id = 'present';
present.width = canvas.width; present.height = canvas.height;
canvas.parentElement.appendChild(present);
const crt = typeof SindenCrt !== 'undefined' ? SindenCrt.install(present, gunProfile, null, { deferred: true, lines: 480, status, onChange: () => panel.refresh() }) : null;
const cycleBorder = () => { frame.cycle(); status(frame.get() ? `Light-gun border ${frame.get()} %` : 'Light-gun border off'); panel.refresh(); };
const toggleFullscreen = () => Cabinet.fullscreen(screen);
const panel = Cabinet.panel($('cabinet'), { groups: [
	{ label: 'Power', rows: [[{ id: 'start', kind: 'power', label: 'Power on', title: 'Switch the machine on' }]] },
	{ label: 'Display', rows: [[
		{ id: 'border', kind: 'key', label: 'Gun border', key: 'F8', readout: () => frame.text(), onClick: cycleBorder },
		{ id: 'crt', kind: 'key', label: 'CRT', key: 'F9', readout: () => (crt ? crt.text() : 'OFF'), onClick: () => crt && crt.cycle() },
		{ id: 'crtlines', kind: 'fader', label: 'CRT lines', key: 'Shift+F9', steps: SindenCrt.STOPS.length, title: 'The CRT look\u2019s scanlines: AUTO is the game\u2019s own 480; the count shows what fits the screen', value: () => (crt ? crt.stop() : 0), onInput: (i) => crt && crt.setStop(i, true), active: () => !!(crt && crt.get().enabled), readout: () => (crt ? crt.linesText() : 'AUTO') },
		{ id: 'fullscreen', kind: 'key', label: 'Fullscreen', key: 'F11', onClick: toggleFullscreen }]] },
	{ label: 'Sound', rows: [[{ id: 'music', kind: 'key', label: 'CD music', key: 'M', readout: () => (musicOn ? 'ON' : 'OFF'), onClick: () => toggleMusic() }]] },
	{ label: 'Light gun', rows: [[{ id: 'calibrate', kind: 'link', label: 'Calibrate', href: '../calibrate/' }]] },
] });

/* F11 = the page's fullscreen, F8 = the page's frame, taken before SDL sees them */
window.addEventListener('keydown', (e) => {
	if (e.code !== 'F11' && e.code !== 'F8' && !(e.key === 'f' || e.key === 'F') && !(e.key === 'm' || e.key === 'M')) return;
	if (e.code === 'F11' || e.code === 'F8') { e.preventDefault(); e.stopImmediatePropagation(); }
	if (e.repeat) return;
	if (e.code === 'F11' || e.key === 'f' || e.key === 'F') toggleFullscreen();
	else if (e.code === 'F8') cycleBorder();
	else toggleMusic();
}, true);
window.addEventListener('keyup', (e) => { if (e.code === 'F11' || e.code === 'F8') { e.preventDefault(); e.stopImmediatePropagation(); } }, true);

/* ---- the CD's music: the disc's audio tracks as music/trackNN.m4a, played as the game asks
 * ("play cdaudio from N to M" reaches hotdMusic(1, N, M); "stop" is hotdMusic(0)) ---- */
function musicNext() {
	if (!musicQueue.length) { musicCur = 0; return; }
	const t = musicQueue.shift();
	musicCur = t;
	if (!musicEl) { musicEl = new Audio(); musicEl.preload = 'auto'; musicEl.addEventListener('ended', musicNext); musicEl.addEventListener('error', () => { console.warn('music: no track', musicCur); musicNext(); }); }
	musicEl.src = `music/track${String(t).padStart(2, "0")}.m4a`;
	musicEl.volume = musicOn ? musicGain : 0;
	musicEl.play().catch((e) => console.warn('music:', e.message));
}
function hotdMusic(op, first, last) {
	if (op === 2) { musicGain = Math.max(0, Math.min(100, first)) / 100; if (musicEl) musicEl.volume = musicOn ? musicGain : 0; return; }
	if (op === 1) {
		musicQueue = [];
		for (let t = first; t <= last && t < first + 40; t++) musicQueue.push(t);
		musicNext();
	} else {
		musicQueue = [];
		if (musicEl) { musicEl.pause(); musicEl.removeAttribute('src'); musicEl.load(); }
		musicCur = 0;
	}
}
function toggleMusic() {
	musicOn = !musicOn;
	localStorage.setItem('hotd1-music', musicOn ? 'on' : 'off');
	if (musicEl) musicEl.volume = musicOn ? musicGain : 0;
	status(musicOn ? 'CD music on' : 'CD music off');
	panel.refresh();
}

/* ---- the presenter: the engine's thread hands each frame (RGB565, w x h, in wasm memory)
 * to hotdPresent, drawn with WebGL into the page's canvas at the place the engine chose
 * (so the mouse maps the same), sharp-bilinear ---- */
let frames = 0, started = false;
const presenter = (() => {
	let gl, prog, tex, uTs, uOs, uMode, texW = 0, texH = 0;
	function shader(type, src) {
		const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
		if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.warn('[present] shader:', gl.getShaderInfoLog(sh));
		return sh;
	}
	function init() {
		gl = present.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false })
			|| present.getContext('webgl', { alpha: false, antialias: false, depth: false });
		if (!gl) { console.warn('[present] no WebGL'); return false; }
		prog = gl.createProgram();
		gl.attachShader(prog, shader(gl.VERTEX_SHADER,
			'attribute vec2 p; varying vec2 v; void main() { v = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }'));
		gl.attachShader(prog, shader(gl.FRAGMENT_SHADER,
			'precision mediump float; varying vec2 v; uniform sampler2D t; uniform vec2 ts; uniform vec2 os; uniform int mode;\n' +
			'void main() {\n' +
			'  vec2 texel = v * ts;\n' +
			'  vec2 uv = v;\n' +
			'  if (mode == 0 || mode == 2) {\n' +   // sharp-bilinear: nearest at whole multiples, bilinear for the rest
			'    vec2 scale = max(floor(os / ts), vec2(1.0));\n' +
			'    vec2 s = fract(texel);\n' +
			'    vec2 range = 0.5 - 0.5 / scale;\n' +
			'    vec2 d = s - 0.5;\n' +
			'    vec2 f = (d - clamp(d, -range, range)) * scale + 0.5;\n' +
			'    uv = (floor(texel) + f) / ts;\n' +
			'  }\n' +
			'  gl_FragColor = texture2D(t, uv);\n' +
			'}'));
		gl.linkProgram(prog);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('[present] link:', gl.getProgramInfoLog(prog)); return false; }
		gl.useProgram(prog);
		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
		const p = gl.getAttribLocation(prog, 'p');
		gl.enableVertexAttribArray(p);
		gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
		uTs = gl.getUniformLocation(prog, 'ts'); uOs = gl.getUniformLocation(prog, 'os'); uMode = gl.getUniformLocation(prog, 'mode');
		tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
		return true;
	}
	let dead = false;
	return function (ptr, w, h, dx, dy, dw, dh, mode, cw, ch) {
		if (dead) return;
		if (!gl && !init()) { dead = true; return; }
		if (present.width !== cw || present.height !== ch) { present.width = cw; present.height = ch; }
		const px = HEAPU16.subarray(ptr >> 1, (ptr >> 1) + w * h);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		if (w !== texW || h !== texH) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, px);
			texW = w; texH = h;
		} else {
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, px);
		}
		const nearest = mode === 3 || mode === 4;
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
		gl.viewport(0, 0, cw, ch);
		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.viewport(dx, ch - dy - dh, dw, dh);
		gl.uniform2f(uTs, w, h); gl.uniform2f(uOs, dw, dh); gl.uniform1i(uMode, mode);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		frames++;
		if (!started) { started = true; $('loadline').style.display = 'none'; status(''); if (crt) crt.start(); }
	};
})();

/* ---- the engine's module: a global the generated script picks up (EXPORT_NAME=HOTD1) ---- */
const args = location.search.slice(1).split('&').filter((a) => a.startsWith('--')).map(decodeURIComponent);
window.HOTD1 = {
	canvas,
	arguments: ['--run'].concat(args),
	locateFile: (path, prefix) => prefix + path + '?v=' + ver,
	print: (s) => console.log(s),
	printErr: (s) => {
		console.log(s);
		if (/^\[(web|screen|host|fault)\]/.test(s)) status(s.replace(/^\[\w+\]\s*/, ''));
	},
	onAbort: (what) => { status('Stopped: ' + what); console.error(what); },
	onExit: (code) => { status('The game exited (' + code + '). Reload the page to start again.'); },
	setStatus: (s) => { if (s && !started) status(s); },
	// what pcrecomp's win32hle asks of the page (the names are its Red Alert 2 host's)
	ra2Present: presenter,
	ra2Menu: (open) => { present.style.visibility = open ? 'hidden' : 'visible'; },
	ra2PopupMenu: (json, choicePtr) => { new Int32Array(wasmMemory.buffer, choicePtr, 1)[0] = -1; },   // no host menus on this page
	ra2Fullscreen: (on) => { if (on) toggleFullscreen(); else if (document.fullscreenElement) document.exitFullscreen(); },
	hotdMusic,
};

/* ---- stats ---- */
let lastT = performance.now(), lastF = 0;
setInterval(() => {
	const now = performance.now();
	if (started) $('stats').textContent = `${Math.round((frames - lastF) * 1000 / (now - lastT))} fps · frame ${frames}`;
	lastT = now; lastF = frames;
}, 1000);

/* ---- the power button boots the machine (audio needs this user gesture) ---- */
if (!crossOriginIsolated)
	status('This page is not cross-origin isolated — the game thread cannot start (server must send COOP/COEP headers).');
let booted = false;
$('start').addEventListener('click', async () => {
	if (booted) return;
	booted = true;
	$('start').disabled = true;
	panel.item('start').lit(true);
	$('loadline').style.display = 'block';
	status('Loading the machine…');
	try {
		await new Promise((res, rej) => {
			const sc = document.createElement('script');
			sc.src = 'game/hotd1.js?v=' + ver;
			sc.onload = res; sc.onerror = () => rej(new Error('game/hotd1.js failed to load'));
			document.head.appendChild(sc);
		});
		canvas.focus();
	} catch (e) {
		status('Boot failed: ' + (e && e.message ? e.message : String(e)) + ' (see console)');
		console.error('boot error:', e);
		$('start').disabled = false;
		booted = false;
	}
});

/* the calibration suite's correction + smoothing; cursor hidden over the game; fullscreen the gun's
 * fraction is of the frame round the canvas (its outer edge is what the driver maps to the screen) */
try { SindenAim.install(canvas, gunProfile, { frame: frame.element, offscreen: 'edge' }); } catch (e) { console.warn('aim layer:', e.message); }
