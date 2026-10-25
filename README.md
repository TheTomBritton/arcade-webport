# arcade-webport

Web shells for browser ports of recompiled arcade **light-gun games**, with a
**Sinden light gun** aim layer and calibration suite.

This repo is the *web* side only. It contains **no ROMs, no game assets and no
built engines** — you build the engine from its own repo and supply your own
legally-dumped ROM set through the page's file picker (the files are verified
in the browser, cached in IndexedDB, and never uploaded anywhere).

## Games

| Page | Game | Hardware | Engine |
|---|---|---|---|
| `timecrisis/` | Time Crisis (1995) | Namco Super System 22 | [`namco22-decompile` branch `web-port`](https://github.com/TheTomBritton/namco22-decompile/tree/web-port) |
| `timecrisis2/` | Time Crisis II (1997) | Namco System 23 | [`namco22-decompile` branch `tc2-web`](https://github.com/TheTomBritton/namco22-decompile/tree/tc2-web) |
| `virtuacop2/` | Virtua Cop 2 (1995) | Sega Model 2A-CRX | [`model2recomp` branch `vcop2-web`](https://github.com/TheTomBritton/model2recomp/tree/vcop2-web) |
| `lostworld/` | The Lost World: Jurassic Park (1997) | Sega Model 3 Step 1.5 | [`lostworld` branch `web`](https://github.com/TheTomBritton/lostworld/tree/web) on [`model3recomp` branch `web`](https://github.com/TheTomBritton/model3recomp/tree/web) |
| `crisiszone/` | Crisis Zone (1999) | Namco System 23 Evolution 2 | [`namco22-decompile` branch `crszone-web`](https://github.com/TheTomBritton/namco22-decompile/tree/crszone-web) (upstream 0.9.3, which adds Crisis Zone, merged into `tc2-web`) |

Both engines are Emscripten builds of the
[spacestate1/namco22-decompile](https://github.com/spacestate1/namco22-decompile)
static recompilation (the branches above are a fork carrying the web port).
Build with `emcmake cmake` + `cmake --build` per that repo, then drop the
outputs next to the page:

- Time Crisis: `tc.js` + `tc.wasm` into `timecrisis/`
- Time Crisis II: `tc2.js` + `tc2.wasm` into `timecrisis2/`

Virtua Cop 2 is an Emscripten build of
[sp00nznet/model2recomp](https://github.com/sp00nznet/model2recomp) (the
branch above carries the web port and the game's entry points): `vcop2.js` +
`vcop2.wasm` into `virtuacop2/`.

The Lost World is [sp00nznet/lostworld](https://github.com/sp00nznet/lostworld)
on [sp00nznet/model3recomp](https://github.com/sp00nznet/model3recomp); the
branches above add a browser platform layer (`platform_web.c`: the guest on a
pthread, frames and audio in shared memory) and the browser link. Build the
ROM images and lift per that repo, then `emcmake cmake -S . -B build-web` +
`cmake --build build-web`: `lostworld.js` + `lostworld.wasm` into `lostworld/`
(`audio.js`, the page's AudioWorklet, is here). The board keeps its own
57.524 Hz, which on a 60 Hz display repeats a picture now and then;
`?env=M3_PACE:display` paces it on the page's paints instead (every paint a
new field, the game and its sound 4.3% fast).

ROM sets (MAME naming): `timecris.zip` (World TS2 Ver.B), `timecrs2.zip`,
`vcop2.zip` and `lostwsga.zip`. The pages try to fetch a zip hosted next to
them first; when that 404s (as it will here) the manual picker appears. The
Lost World page builds the board's five ROM images from the zip itself, the
same interleave the engine's `rom_loader.py` proves against the PowerPC
exception vectors.

The Namco and Model 2 engines suspend with **JSPI**, so they need Chrome/Edge
137+ for now. The Lost World runs on **pthreads** instead, so its directory
must be served cross-origin isolated (COOP/COEP headers; `test/serve-coop.py`
does that locally).

Each game's battery RAM and EEPROM (high scores, operator and test-menu
settings) is kept between visits in the same IndexedDB store, under
`<game>/save/`. The Namco pages keep the files their engine writes; for
Virtua Cop 2 and The Lost World the page has the module write its nvram file
(`web_save_nvram`, in the branches above) every few seconds, since a browser
tab never quits.

*The House of the Dead 2 page is not included: it derives from
[yunophilia/hotd2-recompiled](https://github.com/yunophilia/hotd2-recompiled),
which has no license yet.*

## The cabinet

- `lib/cabinet.js` — what every page shares around its engine: the light gun's
  frame (a white border and a black gap, drawn by the page round the engine's
  canvas, so no engine insets or clips its own picture; F8 and a panel button
  cycle it 0–6 %), a skeuomorphic control panel (power, coin, start, the
  service switches, border / CRT / fullscreen, calibrate — every function the
  keys reach is a button too) and a key tap for the SDL engines.
- `sinden/crt.js` — a CRT look over the canvas (scanlines, mask, softness,
  dimmer picture; F9 cycles off / 100 / 85 / 70 / 55 %), saved in the
  calibration profile. Scanlines are a whole number of screen pixels tall, so
  they never beat against the pixel grid, and a **CRT LINES** fader on the
  panel (Shift+F9) picks the resolution: AUTO is the game's native line count
  (480 for the Namco and NAOMI games, 384 for Sega Model 2 and 3), or 160 /
  192 / 240 / 320 / 480.

## Sinden light gun

- `sinden/aim.js` — page-level aim layer: linear correction + One Euro
  smoothing, dispatched to the engine's own mouse handlers, plus the 4:3
  picture-box geometry (`box` / `borderPx` / `pictureRect`) the frame and the
  calibration suite share. Fullscreen the gun's fraction maps to the frame's
  outer edge, which is what the Sinden driver maps to the whole screen.
- `calibrate/` — browser calibration suite: shoot targets, get a correction
  profile (localStorage); the game pages read it at boot (border size, CRT
  choice) and patch the engine's crosshair / key settings to match.
- `sinden/index.html` + `gun.js` + `tracker.js` — an experimental in-browser
  driver: Web Serial to the gun's control port, camera tracking of the border
  quad with a homography. Clean-room, protocol per
  [schlarpc/sindenrs](https://github.com/schlarpc/sindenrs)'s notes. See
  `docs/sinden.md`.

Native drivers, if you'd rather not run the gun from a browser tab:
[sindenrs-macos](https://github.com/TheTomBritton/sindenrs-macos) (macOS menu-bar
driver + SteamOS tools) and
[decky-sinden](https://github.com/TheTomBritton/decky-sinden) (Steam Deck /
Decky Loader plugin).

## Serving

The pages are static — any static server works for the Time Crisis pages
(`python3 -m http.server`). `test/serve-coop.py` serves the repo with
COOP/COEP headers for engines that need `SharedArrayBuffer`.

## Tests

Node harnesses in `test/` (need `npm install puppeteer-core` and a Chrome):

- `aim-test.js` — pure-node unit tests for the aim layer geometry/filtering
- `aim-browser-test.js` — the same layer driven in a real page
- `gameplay-test.js`, `browser-test.js`, `soak-test.js`, `f620-test.js`,
  `headed-test.js`, `tc2-gameplay-test.js` — boot/coin/play smoke tests
- `cabinet-test.js` — the frame and control panel on every page
- `crisiszone-gameplay-test.js` — Crisis Zone: boot, ZONE SELECT, the machine gun held, the shield (pedal); env PAGE_BASE, OUT, GL=metal
- `lostworld-page-test.js` — the Lost World page against `serve-coop.py`:
  isolation, ROM build, fields per second, coin and start, screenshots
- `test-rom-import.js` — the ROM importer against a reference build

Environment variables: `ROM_ZIP` (path to your ROM zip), `OUT` (screenshot
dir, default `test/out/`), `MAIN_BIN` (reference main.bin for the importer),
`CHROME` (browser binary where applicable).
