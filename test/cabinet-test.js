// Page test for the cabinet (lib/cabinet.js) on a game page: the ROM auto-load, POWER ON, the
// control panel's buttons (enabled once the machine runs, coin + start tapped), the light gun's
// frame geometry windowed and fullscreen (border = pct of the 4:3 box's short edge, gap inside,
// the canvas filling the rest), F8 / the panel cycling it, the CRT look (F9 / the panel, over the
// canvas only, hidden until power), F11, with screenshots of each state under OUT.
//
//   python3 test/serve-coop.py 8643                (from the repo root; the game's zip next to its page)
//   GAME=timecrisis node test/cabinet-test.js      (timecrisis | timecrisis2 | virtuacop2 | hotd2)
//   PAGE_URL=https://example.test/arcade/timecrisis/ GAME=timecrisis node test/cabinet-test.js
// Env: PAGE_BASE (default http://127.0.0.1:8643), PAGE_URL (a whole URL instead), CHROME, OUT,
// BOOT_MS (wait after POWER ON, default 20000), PROFILE=off (no gun profile), CRT=on (profile starts with it).
'use strict';
const puppeteer = require('puppeteer-core');   // npm install puppeteer-core
const path = require('path'); const fs = require('fs');
const OUT = process.env.OUT || path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const GAME = process.env.GAME || 'timecrisis';
const URL = process.env.PAGE_URL || `${process.env.PAGE_BASE || 'http://127.0.0.1:8643'}/${GAME}/${GAME === 'hotd2' ? '?mute' : ''}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE = process.env.PROFILE === 'off' ? null : { version: 1, enabled: true, affine: [1, 0, 0, 0, 1, 0], smoothing: 0, borderPct: 4, gapPct: 2, crosshair: false, hideCursor: true,
  crt: { enabled: process.env.CRT === 'on', brightness: 85, scanlines: 50, mask: 20, blur: 50 }, calibratedAt: null, stats: null };
let fails = 0; const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!ok) fails++; };
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: ['--no-first-run', '--hide-scrollbars', '--mute-audio', '--window-size=1600,1000', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/favicon|theme\/|404|emscripten GL emulation/.test(t)) errors.push(t); if (/HOST\]|border|coin|credit|Credit/i.test(t) && !/frame \d/.test(t)) console.log('[console]', t.slice(0, 140)); });
  await page.evaluateOnNewDocument((p) => { if (p) localStorage.setItem('arcade.sinden.aim.v1', JSON.stringify(p)); else localStorage.removeItem('arcade.sinden.aim.v1'); }, PROFILE);
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('gamebox').style.display === 'block', { timeout: 300000, polling: 500 });
  const dom = () => page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const rect = (e) => e && e.getBoundingClientRect().toJSON();
    const btns = [...document.querySelectorAll('#cabinet .cab-btn')].map((b) => ({ id: b.id, disabled: !!b.disabled, lit: b.classList.contains('lit'), text: b.textContent.trim().replace(/\s+/g, ' ') }));
    const frame = q('.cab-frame'), gap = q('.cab-gap'), canvas = q('#canvas'), crt = q('.sinden-crt');
    return { btns, frame: rect(frame), framePad: frame && frame.style.padding, frameOn: frame && frame.classList.contains('on'), gapPad: gap && gap.style.padding,
      canvas: rect(canvas), canvasBuf: canvas && [canvas.width, canvas.height], crt: crt && getComputedStyle(crt).display, crtRect: rect(crt),
      fullscreen: document.fullscreenElement && document.fullscreenElement.id, status: document.getElementById('status').textContent };
  });
  // the frame sizes itself from a ResizeObserver once the game box is shown: give it a moment
  await page.waitForFunction(() => { const f = document.querySelector('.cab-frame'); return f && f.style.padding !== ''; }, { timeout: 5000, polling: 50 }).catch(() => {});
  let d = await dom();
  check('panel built with buttons', d.btns.length >= 8, JSON.stringify(d.btns.map((b) => b.id)));
  check('machine buttons disabled before power', d.btns.filter((b) => ['coin', 'p1start', 'test', 'service'].includes(b.id)).every((b) => b.disabled));
  check('frame on from the profile (4 %)', d.frameOn && /^\d+px$/.test(d.framePad), d.framePad + ' gap ' + d.gapPad);
  const W = d.frame.width, H = d.frame.height;
  check('frame is 4:3 windowed', Math.abs(W / H - 4 / 3) < 0.01, `${W}x${H}`);
  check('border px = 4 % of the short edge', parseInt(d.framePad) === Math.floor(4 * Math.min(W, H) / 100), d.framePad);
  check('gap px = 2 % more', parseInt(d.gapPad) === Math.floor(6 * Math.min(W, H) / 100) - parseInt(d.framePad), d.gapPad);
  check('CRT view hidden before power', !d.crt || d.crt === 'none', d.crt);
  await page.screenshot({ path: path.join(OUT, `${GAME}-0-page.png`), fullPage: true });
  await (await page.$('#cabinet')).screenshot({ path: path.join(OUT, `${GAME}-0-panel.png`) });
  await (await page.$('.machine')).screenshot({ path: path.join(OUT, `${GAME}-0-machine.png`) });
  await page.click('#start');
  await sleep(+(process.env.BOOT_MS || 20000));
  d = await dom();
  check('power lamp lit, buttons enabled', d.btns.find((b) => b.id === 'start').lit && d.btns.filter((b) => ['coin', 'p1start'].includes(b.id)).every((b) => !b.disabled));
  check('canvas fills the gap exactly', Math.abs(d.canvas.width - (W - 2 * (parseInt(d.framePad) + parseInt(d.gapPad)))) < 1.5, `${d.canvas.width} vs ${W} buf ${d.canvasBuf}`);
  const shot = async (name, el) => { await (el ? await page.$(el) : page).screenshot({ path: path.join(OUT, `${GAME}-${name}.png`) }); console.log('shot', name); };
  await shot('1-win', '#screen');
  await (await page.$('#cabinet')).screenshot({ path: path.join(OUT, `${GAME}-1-panel-on.png`) });
  // the panel's coin + start
  await page.click('#coin'); await sleep(700); await page.click('#coin'); await sleep(1500);
  await shot('2-win-coin', '#screen');
  // F8 cycles 4 -> 5 -> 6 -> 0; the panel's button -> 1
  await page.focus('#canvas');
  await page.keyboard.press('F8'); await sleep(300); d = await dom();
  check('F8 -> 5 %', parseInt(d.framePad) === Math.floor(5 * Math.min(W, H) / 100) && d.btns.find((b) => b.id === 'border').text.includes('5 %'), d.framePad + ' ' + d.btns.find((b) => b.id === 'border').text);
  await page.keyboard.press('F8'); await page.keyboard.press('F8'); await sleep(300); d = await dom();
  check('F8 x2 -> off, frame black', !d.frameOn && d.framePad === '0px' && d.btns.find((b) => b.id === 'border').text.includes('OFF'), d.framePad);
  check('canvas fills the box with the frame off', Math.abs(d.canvas.width - W) < 1.5, `${d.canvas.width} vs ${W}`);
  await shot('3-win-noframe', '#screen');
  await page.click('#border'); await sleep(300); d = await dom();
  check('panel border button -> 1 %', parseInt(d.framePad) === Math.floor(1 * Math.min(W, H) / 100), d.framePad);
  for (let i = 0; i < 3; i++) { await page.click('#border'); await sleep(100); }   // back to 4
  // CRT: panel button on (100), F9 -> 85
  await page.click('#crt'); await sleep(500); d = await dom();
  check('CRT button -> on, view over the canvas only', d.crt === 'block' && Math.abs(d.crtRect.width - d.canvas.width) < 1.5 && Math.abs(d.crtRect.left - d.canvas.left) < 1.5, JSON.stringify([d.crt, d.crtRect, d.canvas]));
  check('CRT readout 100 %', d.btns.find((b) => b.id === 'crt').text.includes('100 %'), d.btns.find((b) => b.id === 'crt').text);
  await page.keyboard.press('F9'); await sleep(500); d = await dom();
  check('F9 -> 85 %', d.btns.find((b) => b.id === 'crt').text.includes('85 %'), d.btns.find((b) => b.id === 'crt').text);
  await shot('4-win-crt', '#screen');
  // fullscreen via the panel
  await page.click('#fullscreen'); await sleep(1500); d = await dom();
  check('fullscreen = the screen box', d.fullscreen === 'screen', d.fullscreen);
  const FW = d.frame.width, FH = d.frame.height;
  check('fullscreen frame is 4:3 and centred', Math.abs(FW / FH - 4 / 3) < 0.01 && Math.abs(FH - 1000) < 2 && Math.abs(d.frame.left - (1600 - FW) / 2) < 2, JSON.stringify(d.frame));
  check('fullscreen border = 4 % of the box height', parseInt(d.framePad) === Math.floor(4 * Math.round(Math.min(FW, FH)) / 100), d.framePad);
  check('CRT view tracks the fullscreen canvas', d.crt === 'block' && Math.abs(d.crtRect.width - d.canvas.width) < 1.5 && Math.abs(d.crtRect.top - d.canvas.top) < 1.5, JSON.stringify([d.crtRect, d.canvas]));
  await shot('5-full');
  await page.keyboard.press('F9'); await page.keyboard.press('F9'); await page.keyboard.press('F9'); await sleep(600); d = await dom();   // 70, 55, off
  check('F9 x3 -> off', d.btns.find((b) => b.id === 'crt').text.includes('OFF') && d.crt === 'none', d.btns.find((b) => b.id === 'crt').text);
  await shot('6-full-nocrt');
  await page.keyboard.press('F11'); await sleep(1200); d = await dom();
  check('F11 leaves fullscreen', !d.fullscreen);
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  console.log('status:', d.status, '| fails:', fails);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
