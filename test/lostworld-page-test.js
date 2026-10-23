// Page-level test for the site's Lost World page: ROM auto-load, Power on, the
// board's thread presenting frames, a coin and a start, with canvas screenshots
// along the way. Run from the repo root with the game's zip next to its page:
//
//   python3 test/serve-coop.py 8643
//   node test/lostworld-page-test.js
//
// Env: PAGE_URL (default http://127.0.0.1:8643/lostworld/?mute), CHROME, OUT.
'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');
const OUT = process.env.OUT || __dirname;
const URL = process.env.PAGE_URL || 'http://127.0.0.1:8643/lostworld/?mute';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) fails++; };
const frames = () => (window.__lostworld ? window.__lostworld.HEAPU32[window.__lostworld._web_frame_count() >> 2] : 0);
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-first-run', '--hide-scrollbars', '--mute-audio', '--window-size=1024,1400'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 1400 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text()); console.log('[console]', m.text().slice(0, 200)); });
  page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
  console.log('goto', URL);
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  check('cross-origin isolated', await page.evaluate(() => crossOriginIsolated));
  await page.waitForFunction(() => document.getElementById('gamebox').style.display === 'block', { timeout: 300000, polling: 1000 });
  check('ROM loaded and gamebox shown', true);
  const t0 = Date.now();
  await page.click('#start');
  console.log('clicked Power on');
  await page.waitForFunction(frames, { timeout: 240000, polling: 1000 }, );
  await page.waitForFunction(() => window.__lostworld && window.__lostworld.HEAPU32[window.__lostworld._web_frame_count() >> 2] > 300, { timeout: 240000, polling: 1000 });
  check('board presenting fields (> 300)', true);
  // speed: fields per wall second once running, against the board's 57.524
  const a = await page.evaluate(() => window.__lostworld.HEAPU32[window.__lostworld._web_frame_count() >> 2]);
  await sleep(5000);
  const b = await page.evaluate(() => window.__lostworld.HEAPU32[window.__lostworld._web_frame_count() >> 2]);
  const fps = (b - a) / 5;
  console.log(`fields/s: ${fps.toFixed(1)} (board: 57.5)`);
  check('holding at least 50 fields/s', fps >= 50);
  // attract: let it get past the boot and the warning cards
  await page.waitForFunction(() => window.__lostworld.HEAPU32[window.__lostworld._web_frame_count() >> 2] > 2400, { timeout: 120000, polling: 1000 });
  const canvas = await page.$('#canvas');
  await canvas.screenshot({ path: path.join(OUT, 'lostworld-page-attract.png') });
  const lit = await page.evaluate(() => {
    const c = document.getElementById('canvas'), x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < x.length; i += 4) if (x[i] + x[i + 1] + x[i + 2] > 48) n++;
    return n / (x.length / 4);
  });
  console.log(`lit pixels: ${(lit * 100).toFixed(1)} %`);
  check('canvas shows a picture', lit > 0.05);
  // coin and start through the keyboard, as the panel's buttons do
  await page.focus('#canvas');
  await page.keyboard.down('5'); await sleep(200); await page.keyboard.up('5');
  await sleep(1500);
  await page.keyboard.down('1'); await sleep(200); await page.keyboard.up('1');
  console.log('coin + start');
  await sleep(12000);
  await canvas.screenshot({ path: path.join(OUT, 'lostworld-page-started.png') });
  await sleep(15000);
  await canvas.screenshot({ path: path.join(OUT, 'lostworld-page-play.png') });
  const total = await page.evaluate(() => window.__lostworld.HEAPU32[window.__lostworld._web_frame_count() >> 2]);
  console.log(`fields after ${((Date.now() - t0) / 1000).toFixed(0)} s: ${total}`);
  check('no page errors', errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 5));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
