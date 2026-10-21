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

Both engines are Emscripten builds of the
[spacestate1/namco22-decompile](https://github.com/spacestate1/namco22-decompile)
static recompilation (the branches above are a fork carrying the web port).
Build with `emcmake cmake` + `cmake --build` per that repo, then drop the
outputs next to the page:

- Time Crisis: `tc.js` + `tc.wasm` into `timecrisis/`
- Time Crisis II: `tc2.js` + `tc2.wasm` into `timecrisis2/`

ROM sets (MAME naming): `timecris.zip` (World TS2 Ver.B) and `timecrs2.zip`.
The pages try to fetch a zip hosted next to them first; when that 404s (as it
will here) the manual picker appears.

The engines suspend with **JSPI**, so they need Chrome/Edge 137+ for now.

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
  calibration profile.

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
- `test-rom-import.js` — the ROM importer against a reference build

Environment variables: `ROM_ZIP` (path to your ROM zip), `OUT` (screenshot
dir, default `test/out/`), `MAIN_BIN` (reference main.bin for the importer),
`CHROME` (browser binary where applicable).
