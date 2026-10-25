// Crisis Zone page test: boot from the hosted zip (stored in IndexedDB), the 1 COIN 1 CREDIT
// default backup, one coin -> ZONE SELECT (a credit starts the game), the trigger picks the
// zone, then gameplay: the pedal held (shield down, attack) with the trigger held (the machine
// gun fires while it is held). Screenshots of each step under OUT; every console line printed.
// SwiftShader GL: trust boot / logic / layout, not GPU precision.
//
//   python3 test/serve-coop.py 8643                       (from the repo root; crszone.zip next to the page)
//   node test/crisiszone-gameplay-test.js
// Env: PAGE_BASE (default http://127.0.0.1:8643), CHROME, OUT (default test/out), BOOT_MS (default 40000),
// GL=metal (ANGLE on the Mac's GPU, headless, instead of SwiftShader: real speed, real precision).
'use strict';
const puppeteer = require('puppeteer-core');   // npm install puppeteer-core
const path = require('path'); const fs = require('fs');
const OUT = process.env.OUT || path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const URL = `${process.env.PAGE_BASE || 'http://127.0.0.1:8643'}/crisiszone/`;
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

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('gamebox').style.display === 'block', { timeout: 300000, polling: 500 });
  check('ROM zip fetched and stored, game box shown', true, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.click('#start');
  const shot = async (name) => { await (await page.$('#canvas')).screenshot({ path: path.join(OUT, `crisiszone-${name}.png`) }); console.log('shot', name); };
  await sleep(+(process.env.BOOT_MS || 40000));
  await shot('1-attract');
  // the page's own frame counter: requestAnimationFrame paints over 5 s
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 5000) requestAnimationFrame(f); else res(n / 5); }; requestAnimationFrame(f); }));
  console.log('page paints/s', fps.toFixed(1));

  const canvas = await page.$('#canvas');
  const box = await canvas.boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  await canvas.click({ button: 'middle' }).catch(() => {});
  await page.focus('#canvas');
  await page.keyboard.down('5'); await sleep(300); await page.keyboard.up('5');   // one coin, held ~18 frames
  await sleep(4000);
  await shot('2-zone-select');
  await page.mouse.move(...at(0.5, 0.5));
  await page.mouse.down(); await sleep(600); await page.mouse.up();             // the trigger picks the zone
  await sleep(15000);
  await shot('3-zone-start');
  // gameplay: pedal held (right button), the machine gun held (left button) while the aim sweeps
  await page.mouse.move(...at(0.5, 0.45));
  await page.mouse.down({ button: 'right' });
  await sleep(600);
  await page.mouse.down({ button: 'left' });
  for (const [fx, fy] of [[0.3, 0.4], [0.45, 0.45], [0.6, 0.4], [0.7, 0.5], [0.5, 0.55]]) { await page.mouse.move(...at(fx, fy), { steps: 6 }); await sleep(350); }
  await shot('4-firing');
  await page.mouse.up({ button: 'left' });
  await sleep(300);
  await page.mouse.up({ button: 'right' });
  await sleep(1500);
  await shot('5-shield');
  await sleep(8000);
  await shot('6-later');
  // the cabinet's backup RAM + settings reach IndexedDB (persisted every 5 s)
  const saved = await page.evaluate(() => new Promise((res) => {
    const rq = indexedDB.open('arcade-roms', 1);
    rq.onsuccess = () => { const db = rq.result; const g = db.transaction('files').objectStore('files').getAllKeys(); g.onsuccess = () => res(g.result.filter((k) => String(k).startsWith('crszone/'))); g.onerror = () => res([]); };
    rq.onerror = () => res([]);
  }));
  check('saves in IndexedDB', saved.includes('crszone/save/crszone_backup.nv') && saved.includes('crszone/save/crszone.cfg'), saved.join(', '));
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  console.log('--- ALL page console lines ---');
  for (const l of logs) console.log(l);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
