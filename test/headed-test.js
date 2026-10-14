// Headed run on the REAL GPU: drive the page UI like a player would,
// screenshot each step, and capture every console/GL message.
'use strict';
const puppeteer = require('puppeteer-core');
const SCRATCH = process.env.OUT || (__dirname + '/out'); require('fs').mkdirSync(SCRATCH, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false,
    userDataDir: SCRATCH + '/chrome-profile',
    args: ['--window-size=1100,950', '--no-first-run'],
    defaultViewport: null,
  });
  const page = (await browser.pages())[0] || await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));

  await page.goto('http://localhost:8777/timecrisis/', { waitUntil: 'networkidle2' });
  await (await page.$('#romfile')).uploadFile(process.env.ROM_ZIP);
  await page.waitForSelector('#gamebox', { visible: true, timeout: 60000 });
  await page.click('#start');
  console.log('booted on real GPU, watching attract...');
  await new Promise(r => setTimeout(r, 11000));

  const canvas = await page.$('#canvas');
  const box = await canvas.boundingBox();
  await canvas.screenshot({ path: SCRATCH + '/gpu-1-attract.png' });

  await canvas.click();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.down('5'); await new Promise(r => setTimeout(r, 150)); await page.keyboard.up('5');
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 1500));
  await canvas.screenshot({ path: SCRATCH + '/gpu-2-modeselect.png' });

  // shoot STORY GAME (upper box, center)
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35, { steps: 4 });
  await page.mouse.down(); await new Promise(r => setTimeout(r, 100)); await page.mouse.up();
  await new Promise(r => setTimeout(r, 4000));
  // fast-forward the cinematic: shoot the screen twice
  for (let i = 0; i < 2; i++) {
    await page.mouse.down(); await new Promise(r => setTimeout(r, 100)); await page.mouse.up();
    await new Promise(r => setTimeout(r, 1500));
  }
  await new Promise(r => setTimeout(r, 6000));
  await canvas.screenshot({ path: SCRATCH + '/gpu-3-stage1.png' });

  // pop out of cover: HOLD the pedal (right button) while aiming/shooting
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down({ button: 'right' });
  await new Promise(r => setTimeout(r, 1500));
  await canvas.screenshot({ path: SCRATCH + '/gpu-3b-exposed.png' });
  // play a little: aim and shoot around
  for (const [fx, fy] of [[0.35, 0.45], [0.65, 0.4], [0.5, 0.55]]) {
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 6 });
    await page.mouse.down(); await new Promise(r => setTimeout(r, 90)); await page.mouse.up();
    await new Promise(r => setTimeout(r, 800));
  }
  await canvas.screenshot({ path: SCRATCH + '/gpu-4-firefight.png' });
  await page.mouse.up({ button: 'right' });

  // the game's own Escape menu
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 1200));
  await canvas.screenshot({ path: SCRATCH + '/gpu-5-menu.png' });
  await page.keyboard.press('Escape');

  console.log('--- all lines ---');
  for (const l of logs.filter(l => !/\[TC\]|\[tc\]/.test(l)).slice(0, 50)) console.log(l);
  console.log('--- total console lines:', logs.length, '---');
  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e.message); process.exit(1); });
