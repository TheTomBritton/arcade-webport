// TC2 gameplay test v2: boot, coin (LONG holds — 5 frames is too short, 12+ works),
// trigger -> SELECT GAME MODE, shoot SOLO ONLY, wait for stage 1, aim + shoot.
// SwiftShader GL: trust BOOT/LOGIC only. Prints EVERY console line.
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
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));

  await page.goto('http://localhost:8777/timecrisis2/', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForSelector('#gamebox', { visible: true, timeout: 120000 });
  console.log('gamebox visible (zip stored)');
  await page.click('#start');
  console.log('booting...');
  await new Promise(r => setTimeout(r, 25000));

  const canvas = await page.$('#canvas');
  const box = await canvas.boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  await canvas.screenshot({ path: SCRATCH + '/tc2-0-boot.png' });

  await canvas.click();
  for (let i = 0; i < 4; i++) {               // 4 coins, held ~15 frames each
    await page.keyboard.down('5');
    await new Promise(r => setTimeout(r, 260));
    await page.keyboard.up('5');
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 1000));
  await canvas.screenshot({ path: SCRATCH + '/tc2-1-coins.png' });

  // trigger pull -> SELECT GAME MODE
  await page.mouse.move(...at(0.5, 0.5));
  await page.mouse.down(); await new Promise(r => setTimeout(r, 200)); await page.mouse.up();
  await new Promise(r => setTimeout(r, 2500));
  await canvas.screenshot({ path: SCRATCH + '/tc2-2-modeselect.png' });

  // shoot the SOLO ONLY banner (lower box, ~65% down)
  await page.mouse.move(...at(0.4, 0.66), { steps: 4 });
  await page.mouse.down(); await new Promise(r => setTimeout(r, 150)); await page.mouse.up();
  console.log('mode selected, waiting for stage 1...');
  await new Promise(r => setTimeout(r, 18000));
  await canvas.screenshot({ path: SCRATCH + '/tc2-3-stage.png' });

  // gameplay: step out with the pedal (hold right button = out of cover), aim and shoot
  for (const [fx, fy] of [[0.3, 0.4], [0.7, 0.35], [0.5, 0.5], [0.6, 0.6]]) {
    await page.mouse.move(...at(fx, fy), { steps: 5 });
    await page.mouse.down(); await new Promise(r => setTimeout(r, 90)); await page.mouse.up();
    await new Promise(r => setTimeout(r, 700));
  }
  await canvas.screenshot({ path: SCRATCH + '/tc2-4-shooting.png' });
  await new Promise(r => setTimeout(r, 6000));
  await canvas.screenshot({ path: SCRATCH + '/tc2-5-later.png' });

  console.log('--- ALL page console lines ---');
  for (const l of logs) console.log(l);
  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
