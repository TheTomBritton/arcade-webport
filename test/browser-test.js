// End-to-end: real page, real zip through the file picker, real boot.
'use strict';
const puppeteer = require('puppeteer-core');

const SCRATCH = process.env.OUT || (__dirname + '/out'); require('fs').mkdirSync(SCRATCH, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--window-size=1200,1000', '--use-gl=angle', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(require('fs').readFileSync(__dirname + '/inject.js', 'utf8'));
  await page.setViewport({ width: 1200, height: 1000 });

  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));

  await page.goto('http://localhost:8777/timecrisis/', { waitUntil: 'networkidle2' });

  // feed the real zip to the file input
  const input = await page.$('#romfile');
  await input.uploadFile(process.env.ROM_ZIP);

  // wait for verification to finish and the game box to appear
  await page.waitForSelector('#gamebox', { visible: true, timeout: 60000 });
  const report = await page.$eval('#report', el => el.innerText.split('\n').slice(0, 3).join(' | '));
  console.log('VERIFY:', report, '...');

  await page.click('#start');
  console.log('clicked start...');
  const canvas = await page.$('#canvas');
  for (const [t, name] of [[11000, 'web-3d.png'], [9000, 'web-canvas.png']]) {
    await new Promise(r => setTimeout(r, t));
    await canvas.screenshot({ path: SCRATCH + '/' + name });
  }
  await page.screenshot({ path: SCRATCH + '/web-page.png' });

  const size = await page.$eval('#canvas', c => `${c.width}x${c.height}`);
  console.log('canvas backing size:', size);
  console.log('--- all console lines ---');
  for (const l of logs) console.log(l);
  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e.message); process.exit(1); });
