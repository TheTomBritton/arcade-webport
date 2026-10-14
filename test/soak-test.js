// Soak test on the real GPU: snapshot the canvas every 400ms through attract,
// coin-up and gameplay, then scan every frame for anomalies (black-pixel
// ratio) so transient, pacing-dependent glitches can't hide between shots.
'use strict';
const fs = require('fs');
const { PNG } = require('pngjs');
const puppeteer = require('puppeteer-core');
const SCRATCH = process.env.OUT || (__dirname + '/out'); require('fs').mkdirSync(SCRATCH, { recursive: true });
const DIR = SCRATCH + '/soak';

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false,
    args: ['--window-size=1100,950', '--no-first-run'],
    defaultViewport: null,
  });
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.goto('http://localhost:8777/timecrisis/', { waitUntil: 'networkidle2' });
  await (await page.$('#romfile')).uploadFile(process.env.ROM_ZIP);
  await page.waitForSelector('#gamebox', { visible: true, timeout: 60000 });
  await page.click('#start');
  await new Promise(r => setTimeout(r, 4000));

  const canvas = await page.$('#canvas');
  const box = await canvas.boundingBox();
  let n = 0;
  const snap = async () => { try { await canvas.screenshot({ path: `${DIR}/f${String(n++).padStart(3, '0')}.png` }); } catch (_) {} };
  const timer = setInterval(snap, 400);

  // let attract play ~20s (castle flyover included), then coin up and play ~25s
  await new Promise(r => setTimeout(r, 20000));
  await canvas.click();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.down('5'); await new Promise(r => setTimeout(r, 150)); await page.keyboard.up('5');
    await new Promise(r => setTimeout(r, 400));
  }
  await new Promise(r => setTimeout(r, 1500));
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35);
  await page.mouse.down(); await new Promise(r => setTimeout(r, 100)); await page.mouse.up();
  await new Promise(r => setTimeout(r, 5000));
  await page.mouse.down(); await new Promise(r => setTimeout(r, 100)); await page.mouse.up(); // ff cinematic
  await new Promise(r => setTimeout(r, 5000));
  await page.mouse.down({ button: 'right' });              // pedal: pop out
  for (let i = 0; i < 10; i++) {
    const fx = 0.3 + 0.4 * Math.random(), fy = 0.3 + 0.3 * Math.random();
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 4 });
    await page.mouse.down(); await new Promise(r => setTimeout(r, 80)); await page.mouse.up();
    await new Promise(r => setTimeout(r, 1200));
  }
  await page.mouse.up({ button: 'right' });

  clearInterval(timer);
  await browser.close();

  // scan all frames: black-pixel ratio + mean brightness
  const rows = [];
  for (const f of fs.readdirSync(DIR).sort()) {
    const png = PNG.sync.read(fs.readFileSync(`${DIR}/${f}`));
    let black = 0, sum = 0; const total = png.width * png.height;
    for (let i = 0; i < png.data.length; i += 4) {
      const v = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
      sum += v;
      if (v < 8) black++;
    }
    rows.push({ f, black: +(100 * black / total).toFixed(1), mean: +(sum / total).toFixed(1) });
  }
  console.log('frames:', rows.length);
  console.log('worst by black%:');
  for (const r of [...rows].sort((a, b) => b.black - a.black).slice(0, 10)) console.log(' ', r.f, r.black + '%', 'mean', r.mean);
})().catch(e => { console.error('TEST FAILED:', e.message); process.exit(1); });
