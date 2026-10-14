// Deterministic single-frame A/B: stop the web build exactly at frame 620
// (the native castle reference) and screenshot the canvas.
'use strict';
const puppeteer = require('puppeteer-core');
const SCRATCH = process.env.OUT || (__dirname + '/out'); require('fs').mkdirSync(SCRATCH, { recursive: true });
const env = process.argv[2] || '';          // e.g. ENG_NODEPTH:1
const out = process.argv[3] || 'web620.png';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false,
    args: ['--window-size=1100,950', '--no-first-run'],
    defaultViewport: null,
  });
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setViewport({ width: 1100, height: 950, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  const q = '?args=' + (process.env.TC_ARGS || '--window,1,--frames,1200') + (env ? '&env=' + env : '');
  await page.goto('http://localhost:8777/timecrisis/' + q, { waitUntil: 'networkidle2' });
  await (await page.$('#romfile')).uploadFile(process.env.ROM_ZIP);
  await page.waitForSelector('#gamebox', { visible: true, timeout: 60000 });
  await page.evaluate(() => { window.__drawprobe = 1; });
  await page.click('#start');
  for (let i = 0; i < 300; i++) {                      /* shoot LIVE in the castle segment */
    await new Promise(r => setTimeout(r, 200));
    if (logs.some(l => / frame (6[6-9]0|7[0-9]0) /.test(l))) break;
  }
  await (await page.$('#canvas')).screenshot({ path: `${SCRATCH}/${out}` });
  if (process.env.TC_PULL) {                    /* pull MEMFS files, e.g. TC_PULL=nd/wram_f660.bin */
    const fs = require('fs');
    for (const f of process.env.TC_PULL.split(',')) {
      const b64 = await page.evaluate(p => {
        try { const d = window.__tc.FS.readFile('/game/' + p); let s2 = '';
          for (let i = 0; i < d.length; i += 0x8000) s2 += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
          return btoa(s2); } catch (e) { return null; }
      }, f);
      if (b64) { fs.writeFileSync(`${SCRATCH}/web-${f.replace(/\//g, '_')}`, Buffer.from(b64, 'base64')); console.log('pulled', f); }
      else console.log('MISSING', f);
    }
  }
  console.log('shot at:', (logs.filter(l => / frame \d+ /.test(l)).pop() || 'none').slice(0, 60));
  for (const l of logs.filter(l => l.includes('SRC>>>'))) console.log(l);
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
