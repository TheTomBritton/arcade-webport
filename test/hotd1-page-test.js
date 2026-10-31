// The House of the Dead page test: the engine (game/hotd1.js) loads, the game folder is fetched from
// game/data/ as the game reads it, the title and the attract demo draw through the page's presenter,
// Space skips the demo, the menu's hand follows the pointer and a click opens a menu. Screenshots of
// each step under OUT; every console line printed. SwiftShader GL: trust boot / logic / layout.
//
//   python3 test/serve-coop.py 8643                       (from the repo root)
//   node test/hotd1-page-test.js
// Env: PAGE_BASE (default http://127.0.0.1:8643), CHROME, OUT (default test/out), BOOT_MS (default 25000),
// GL=metal (ANGLE on the Mac's GPU, headless, instead of SwiftShader).
'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path'); const fs = require('fs');
const OUT = process.env.OUT || path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const URL = `${process.env.PAGE_BASE || 'http://127.0.0.1:8643'}/hotd1/${process.env.ARGS ? '?' + process.env.ARGS : ''}`;   // ARGS: engine switches, e.g. --frametrace&--msgtrace
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: ['--no-first-run', '--window-size=1200,1000', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
      ...(process.env.GL === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1000 });
  const logs = [], errors = [];
  page.on('console', (m) => { const t = m.text(); logs.push(t); if (m.type() === 'error' && !/favicon|theme\/|404/.test(t)) errors.push(t); });
  page.on('pageerror', (e) => { logs.push('PAGEERROR: ' + e.message); errors.push(e.message); });
  page.on('response', (r) => { if (r.status() >= 400 && !/theme\//.test(r.url())) logs.push(`HTTP ${r.status()} ${r.url()}`); });

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
  check('page loaded, cross-origin isolated', await page.evaluate(() => window.crossOriginIsolated === true));
  await page.waitForSelector('#start', { timeout: 60000 });     // the panel is built after version.txt arrives
  await page.click('#start');
  const screen = await page.$('#screen');
  const shot = async (name) => { await screen.screenshot({ path: path.join(OUT, `hotd1-${name}.png`) }); console.log('shot', name); };
  // the presenter's first frame hides the load line
  await page.waitForFunction(() => document.getElementById('loadline').style.display === 'none' && document.getElementById('stats').textContent.includes('fps'), { timeout: +(process.env.BOOT_MS || 25000) + 60000, polling: 500 }).catch(() => {});
  const booted = await page.evaluate(() => document.getElementById('stats').textContent);
  check('engine booted and presents frames', /fps/.test(booted), `${((Date.now() - t0) / 1000).toFixed(1)} s, ${booted}`);
  await sleep(6000);
  await shot('1-title');
  const fps = await page.evaluate(() => document.getElementById('stats').textContent);
  console.log('stats:', fps);
  const rate = parseInt(fps, 10) || 0;
  check('presenting at speed', rate >= 30, `${rate} fps`);
  await page.focus('#canvas');
  await page.keyboard.down('Space'); await sleep(250); await page.keyboard.up('Space');   // skip the demo
  await sleep(5000);
  await shot('2-after-space');
  const canvas = await page.$('#canvas');
  const box = await canvas.boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  await page.mouse.move(...at(0.5, 0.46), { steps: 8 });    // Arcade, the first menu row
  await sleep(1500);
  await shot('3-hand-on-arcade');
  await page.mouse.down(); await sleep(150); await page.mouse.up();
  await sleep(6000);
  await shot('4-after-click');
  await sleep(10000);
  await shot('5-later');
  // gameplay: the gun is the pointer; the trigger is the left button, a reload the right (off screen)
  for (let i = 0; i < 6; i++) {
    const [fx, fy] = [[0.5, 0.5], [0.35, 0.45], [0.65, 0.5], [0.5, 0.35], [0.4, 0.6], [0.6, 0.4]][i];
    await page.mouse.move(...at(fx, fy), { steps: 4 });
    await page.mouse.down(); await sleep(80); await page.mouse.up();
    await sleep(900);
  }
  await shot('6-shooting');
  await page.mouse.down({ button: 'right' }); await sleep(150); await page.mouse.up({ button: 'right' });   // reload
  await sleep(4000);
  for (let i = 0; i < 6; i++) { await page.mouse.move(...at(0.3 + 0.08 * i, 0.5), { steps: 3 }); await page.mouse.down(); await sleep(80); await page.mouse.up(); await sleep(700); }
  await shot('7-shooting-again');
  await sleep(8000);
  await shot('8-later');
  const fps2 = await page.evaluate(() => document.getElementById('stats').textContent);
  console.log('stats at the end:', fps2);
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  console.log('--- ALL page console lines ---');
  for (const l of logs) console.log(l);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
