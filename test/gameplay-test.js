// Gameplay test: coin, start, aim with the mouse, shoot. The mouse is what a
// Sinden presents to the OS, so this validates the whole light-gun path.
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
  await page.setViewport({ width: 1200, height: 1000 });
  const logs = [];
  page.on('console', m => logs.push(m.text()));

  await page.goto('http://localhost:8777/timecrisis/', { waitUntil: 'networkidle2' });
  await (await page.$('#romfile')).uploadFile(process.env.ROM_ZIP);
  await page.waitForSelector('#gamebox', { visible: true, timeout: 60000 });
  await page.click('#start');
  console.log('booting...');
  await new Promise(r => setTimeout(r, 8000));

  const canvas = await page.$('#canvas');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await canvas.click();                       // focus the canvas
  console.log('focused element: ' + await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
  for (let i = 0; i < 3; i++) {               // 3 coins, held a few frames each
    await page.keyboard.down('5');
    await new Promise(r => setTimeout(r, 150));
    await page.keyboard.up('5');
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 1500));
  await canvas.screenshot({ path: SCRATCH + '/play-0-coins.png' });
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down(); await new Promise(r => setTimeout(r, 120)); await page.mouse.up();   // trigger = start
  console.log('coined + trigger-started, waiting for stage 1...');
  await new Promise(r => setTimeout(r, 12000));
  await canvas.screenshot({ path: SCRATCH + '/play-1-stage.png' });

  // aim around and shoot a few times
  for (const [fx, fy] of [[0.3, 0.4], [0.7, 0.35], [0.5, 0.5], [0.6, 0.6]]) {
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 5 });
    await page.mouse.down(); await new Promise(r => setTimeout(r, 80)); await page.mouse.up();
    await new Promise(r => setTimeout(r, 600));
  }
  await canvas.screenshot({ path: SCRATCH + '/play-2-shooting.png' });

  // hold right button = pedal released (take cover state change), then F8 gun border
  await page.keyboard.press('F8');
  await new Promise(r => setTimeout(r, 300));
  await page.keyboard.press('F8');
  await new Promise(r => setTimeout(r, 500));
  await canvas.screenshot({ path: SCRATCH + '/play-3-border.png' });

  console.log('--- tail logs ---');
  for (const l of logs.slice(-8)) console.log(l);
  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e.message); process.exit(1); });
