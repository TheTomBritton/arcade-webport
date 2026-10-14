// Headless deterministic castle-flyover capture (frame ~660-790) for the
// emscripten #27945 fix verification. Usage: node f660-headless.js <env> <out.png>
//   env: extra ?env pairs, e.g. "ENG_STALE_WA_OFF:1" ('' for none; ENG_FTIME:1 always added)
'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');

const extraEnv = process.argv[2] || '';
const out = process.argv[3] || 'f660.png';
const OUT = __dirname;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-first-run', '--hide-scrollbars', '--mute-audio', '--window-size=1100,950'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 950, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));

  const env = 'ENG_FTIME:1' + (extraEnv ? ',' + extraEnv : '');
  const url = 'http://127.0.0.1:8781/timecrisis/?args=--window,1,--frames,1200&env=' + env;
  console.log('goto', url);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });

  // hosted-zip auto-import -> gamebox
  await page.waitForFunction(
    () => document.getElementById('gamebox').style.display === 'block',
    { timeout: 180000, polling: 500 });
  console.log('gamebox shown');
  await page.click('#start');

  // [FTIME] frame N every 60 frames; castle segment ~600-850
  let seen = null;
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const hit = logs.find((l) => /\[FTIME\] frame (6[6-9]\d|7[0-5]\d) /.test(l));
    if (hit) { seen = hit; break; }
  }
  await (await page.$('#canvas')).screenshot({ path: path.join(OUT, out) });
  console.log('shot after:', seen ? seen.slice(0, 80) : 'TIMEOUT (no castle-frame log!)');
  const errs = logs.filter((l) => l.startsWith('PAGEERROR'));
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
  console.log(seen ? 'CAPTURE OK' : 'CAPTURE TIMEOUT');
  process.exit(seen ? 0 : 1);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
