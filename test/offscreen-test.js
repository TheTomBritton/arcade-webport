// Off-screen shots (aim.js install opts.offscreen): fullscreen, a press on the screen's
// outermost pixel must reach the canvas as the game's reload - a right press ('right':
// Lost World, Virtua Cop 2) or a left press outside the picture ('edge': HOTD2) - with or
// without the calibration profile, and as both pointer and mouse events (SDL reads mouse).
//
//   python3 -m http.server 8777   (in web/)
//   NODE_PATH=<dir with puppeteer-core> [CHROME=<chrome binary>] node test/offscreen-test.js
const puppeteer = require('puppeteer-core');
let fail = 0; const check = (n, ok, d) => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' :: ' + d)); if (!ok) fail++; };
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--window-size=1600,900'], defaultViewport: null });
  for (const [mode, on] of [['right','0'],['right','1'],['edge','0'],['edge','1'],['','1']]) {
    const p = await b.newPage();
    await p.goto(`http://localhost:8777/test/offscreen-fixture.html?mode=${mode}&on=${on}`);
    await p.click('#fs'); await p.waitForFunction(() => document.fullscreenElement, { timeout: 3000 }).catch(() => {});
    const fs = await p.evaluate(() => !!document.fullscreenElement);
    if (!fs) { check(`${mode}/${on}: fullscreen`, false, 'refused'); continue; }
    const [vw, vh] = await p.evaluate(() => [innerWidth, innerHeight]);
    const tag = `mode=${mode || 'none'} profile=${on === '1' ? 'on' : 'off'}`;
    const shoot = async (x, y) => { await p.evaluate(() => { __ev.length = 0; }); await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.up(); return p.evaluate(() => __ev.slice()); };
    const edge = await shoot(0, vh / 2);
    const right = await shoot(vw - 1, vh / 2);
    const mid = await shoot(vw / 2, vh / 2);
    if (mode === 'right') {
      check(`${tag}: left edge press -> right button on canvas`, edge.length >= 2 && edge.every(e => e.b === 2) && edge.some(e => e.t.endsWith('down') && e.bs === 2) && edge.some(e => e.t.endsWith('up')) && edge.some(e => e.t === 'mousedown') && edge.some(e => e.t === 'pointerdown'), JSON.stringify(edge));
      check(`${tag}: right edge too`, right.length >= 2 && right.every(e => e.b === 2), JSON.stringify(right));
    } else if (mode === 'edge') {
      check(`${tag}: edge press reaches canvas as a left press outside the picture`, edge.some(e => e.t === 'mousedown') && edge.length >= 2 && edge.every(e => e.b === 0 && e.x === 0), JSON.stringify(edge));
    } else {
      check(`${tag}: no mode = unchanged (no right button)`, edge.every(e => e.b === 0), JSON.stringify(edge));
    }
    check(`${tag}: mid-screen press stays a left press`, mid.length >= 2 && mid.every(e => e.b === 0), JSON.stringify(mid));
    await p.close();
  }
  await b.close(); console.log(fail ? `${fail} failed` : 'all passed'); process.exit(fail ? 1 : 0);
})();
