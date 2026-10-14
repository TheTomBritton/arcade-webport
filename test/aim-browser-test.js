// Browser test for the aim layer on the Time Crisis page: the page still boots,
// the engine's own mouse handlers still get every event (with the light-gun
// profile off, and on), and the profile's
// border/crosshair reach the engine's settings file.
//
// Drives an already-running Chrome over the DevTools protocol, so it works with
// any Chrome on any OS:
//   chrome --headless=new --remote-debugging-port=9333 --user-data-dir=<scratch>
//   python3 -m http.server 8777        (from the repo root; timecrisis/timecris.zip present)
//   BROWSER_URL=http://127.0.0.1:9333 node aim-browser-test.js
//   PAGE_URL=http://localhost:8777/timecrisis2/ CFG=tc2.cfg node aim-browser-test.js
'use strict';
const puppeteer = require('puppeteer-core');

const BROWSER_URL = process.env.BROWSER_URL || 'http://127.0.0.1:9333';
const PAGE = process.env.PAGE_URL || 'http://localhost:8777/timecrisis/';
const CFG = process.env.CFG || 'tc_controls.cfg';   // the engine's settings file (tc2.cfg for TC2)

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// Record every mouse listener the page registers (that is how SDL's are found)
// and what each one receives.
function spy() {
  window.__mouse = [];
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (/^mouse(move|down|up)$/.test(type) && typeof fn === 'function' && !String(fn).includes('ours.has')) {
      const wrapped = function (e) {
        window.__mouse.push({ type: e.type, x: e.clientX, y: e.clientY, trusted: e.isTrusted });
        return fn.apply(this, arguments);
      };
      return orig.call(this, type, wrapped, opts);
    }
    return orig.call(this, type, fn, opts);
  };
}

async function boot(browser, profile) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 960 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/emscripten GL emulation/.test(m.text())) return;           // the engine's own build notice
    // a bare local server has no favicon, nor the main site's chrome (/theme/, /favicon.svg)
    if (/\/favicon\.(ico|svg)$|\/theme\//.test((m.location() || {}).url || '')) return;
    errors.push(m.text());
  });
  await page.evaluateOnNewDocument(spy);
  await page.evaluateOnNewDocument((p) => {
    if (p) localStorage.setItem('arcade.sinden.aim.v1', JSON.stringify(p));
    else localStorage.removeItem('arcade.sinden.aim.v1');
  }, profile);
  await page.goto(PAGE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#gamebox', { visible: true, timeout: 120000 });
  await page.click('#start');
  await page.waitForFunction(() => window.__tc || window.__tc2, { timeout: 120000 });
  await new Promise(r => setTimeout(r, 6000));          // let the engine come up
  return { page, errors };
}

async function moveAndRead(page, x, y) {
  await page.evaluate(() => { window.__mouse.length = 0; });
  await page.mouse.move(x, y);
  await page.mouse.move(x + 1, y);
  await page.mouse.move(x, y);
  return page.evaluate(() => window.__mouse.slice());
}

(async () => {
  const browser = await puppeteer.connect({ browserURL: BROWSER_URL });

  // --- profile off: behaviour unchanged ---------------------------------------
  {
    const { page, errors } = await boot(browser, null);
    check('off: page boots without errors', errors.length === 0, errors.join(' | '));
    const box = await (await page.$('#canvas')).boundingBox();
    const got = await moveAndRead(page, box.x + box.width * 0.3, box.y + box.height * 0.6);
    check('off: engine handlers get the real mouse events', got.length > 0 && got.every(g => g.trusted), JSON.stringify(got.slice(0, 2)));
    await page.close();
  }

  // --- profile on: events re-dispatched, settings written ------------------------
  {
    const profile = { version: 1, enabled: true, affine: [1, 0, 0.05, 0, 1, 0], smoothing: 0,
                      borderPct: 3, crosshair: false, hideCursor: true, calibratedAt: 1, stats: null };
    const { page, errors } = await boot(browser, profile);
    check('on: page boots without errors', errors.length === 0, errors.join(' | '));
    const box = await (await page.$('#canvas')).boundingBox();
    const tx = box.x + box.width * 0.3, ty = box.y + box.height * 0.6;
    const got = await moveAndRead(page, tx, ty);
    const fromLayer = got.filter(g => !g.trusted);
    check('on: engine handlers get the layer\'s events, not the raw ones',
      got.length > 0 && fromLayer.length === got.length, JSON.stringify(got.slice(0, 3)));
    // windowed: the correction is fitted to the whole screen, so it is not applied here
    check('on: windowed aim is not shifted', fromLayer.some(g => Math.abs(g.x - tx) < 1.5 && Math.abs(g.y - ty) < 1.5),
      JSON.stringify(fromLayer.slice(0, 3)));
    // presses reach the engine too
    await page.evaluate(() => { window.__mouse.length = 0; });
    await page.mouse.down(); await page.mouse.up();
    const presses = await page.evaluate(() => window.__mouse.filter(m => m.type !== 'mousemove'));
    check('on: trigger presses reach the engine', presses.some(p => p.type === 'mousedown' && !p.trusted) && presses.some(p => p.type === 'mouseup'),
      JSON.stringify(presses));
    const cursor = await page.evaluate(() => getComputedStyle(document.getElementById('canvas')).cursor);
    check('on: cursor hidden over the canvas', cursor === 'none', cursor);
    const cfg = await page.evaluate((cfgName) => {
      try { return (window.__tc || window.__tc2).FS.readFile('/game/' + cfgName, { encoding: 'utf8' }); } catch (e) { return 'ERR ' + e; }
    }, CFG);
    check('on: border written to the engine settings', /^gun_border = 3$/m.test(cfg), cfg);
    check('on: crosshair written to the engine settings', /^crosshair = 0$/m.test(cfg), cfg);
    // fullscreen: the correction applies (this profile shifts aim right by 5 % of the screen)
    await page.click('#fullscreen');
    await page.waitForFunction(() => document.fullscreenElement, { timeout: 5000 }).catch(() => {});
    if (await page.evaluate(() => !!document.fullscreenElement)) {
      const [vw, vh] = await page.evaluate(() => [innerWidth, innerHeight]);
      const fs = (await moveAndRead(page, vw * 0.4, vh * 0.5)).filter(g => !g.trusted);
      check('fullscreen: aim corrected', fs.some(g => Math.abs(g.x - vw * 0.45) < 1.5), `want x≈${vw * 0.45}: ${JSON.stringify(fs.slice(0, 3))}`);
      const edge = await moveAndRead(page, 0, vh * 0.5);
      check('fullscreen: the screen edge passes through (reload)', edge.some(g => g.x === 0), JSON.stringify(edge.slice(0, 3)));
      await page.evaluate(() => document.exitFullscreen());
    } else check('fullscreen: entered', false, 'headless Chrome refused fullscreen');
    await page.close();
  }

  // --- the calibration suite loads clean ---------------------------------------
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/favicon\.ico$/.test((m.location() || {}).url || '')) errors.push(m.text()); });
    await page.goto(new URL('../calibrate/', PAGE).href, { waitUntil: 'networkidle2' });
    check('calibrate: page loads without errors', errors.length === 0, errors.join(' | '));
    check('calibrate: shows the profile', /smoothing/.test(await page.$eval('#profile', e => e.textContent)));
    await page.close();
  }

  browser.disconnect();
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
