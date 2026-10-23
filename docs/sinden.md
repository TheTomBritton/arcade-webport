# Sinden lightgun: in-browser driver plan and notes

**Status 2026-10-20: the games are played with the real gun on a Steam Deck
docked to a 1080p TV, through the native driver path (sindenrs fork as a
user service + the OS mouse); see the log at the end. The in-browser driver
(`sinden/gun.js`, `tracker.js`, the feasibility console) is still a
prototype passing synthetic tests only, and is on hold while the native path
works.**

Where the current pieces live in this stack:

- The white border is drawn in-engine: `namco22-decompile/engine/eng_display.c`
  (`gun_border` cfg, 0–6 % of the short edge, cycled by `eng_disp_cycle_gun_border()`).
- Gun aim comes from SDL's **absolute** mouse position:
  `namco22-decompile/engine/ss22_input.c` (~line 759, "the light gun: where it
  points"), clamped to 0..1. In the browser build, Emscripten's SDL2 maps canvas
  mouse events into that, so the web path inherits whatever SDL does with
  coordinates and the context menu — verify, don't assume (first items below).
- The game page (`timecrisis/index.html`) has a Fullscreen button on the canvas
  already; no pointer lock is requested anywhere.
- **New:** `web/sinden/` — the driver work. `gun.js` (Web Serial protocol
  driver), `tracker.js` (border detection + homography → aim), `index.html`
  (the feasibility console). Tests: `web/test/sinden-test.js` (node; protocol
  known-answer vectors and synthetic-frame tracking accuracy).

## The protocol is no longer unknown

[schlarpc/sindenrs](https://github.com/schlarpc/sindenrs) is a **clean-room,
MIT-licensed** Sinden driver in Rust whose docs/notes.md documents the whole
wire protocol from the author's own hardware sessions, and
[TheBrinkOfTomorrow/sindenrs-macos](https://github.com/TheBrinkOfTomorrow/sindenrs-macos)
is a working macOS port of it (also MIT). `web/sinden/gun.js` implements the
protocol from those notes, with attribution. Key facts:

- Control device: `16c0:0f01` "SindenLightgun" (ATmega32U4, Arduino Leonardo
  core), CDC-ACM serial at **115200 8N1**, behind the gun's own USB hub next to
  the camera (`32e4:9210`, "SindenCamera<X>"). Composite HID too: an absolute
  mouse (X/Y 0..32767), keyboard, joystick.
- Framing: host→gun is always 7 bytes, `AA cmd p1 p2 p3 p4 BB`. Replies are raw
  bytes, length implied by the command.
- **Auth**: mutual SHA-256 handshake gates streaming (fixed secrets, same in
  every vendor build; in gun.js). Takes ~650 ms (the gun computes slowly).
- **Buttons**: nothing is sent until command 50 ("secondary serial output")
  enables reports; then every press/release arrives as `FE <state1> <state2> 96`.
  state1 bit 0 = trigger, 1 pump, 2/3 front-left/right, 4/5 rear-left/right;
  state2 bits 0-3 = d-pad. Ten controls total.
- **Position**: command 40, two big-endian 16-bit axes 0..32767 = 0..100 % of
  screen. The gun then reports that position through its own absolute HID
  mouse — i.e. a tracker can drive the **OS cursor** through the gun, with
  clicks landing at the aim. (Command 121 twice starts streaming, after auth.)
- **Recoil**: 161 enable, 167+172 strength 0-250 (saturates ≈ wire 100; 172
  latches), 171 timing, 163 trigger mode (single/repeat), 164/165 which events
  kick, 168 fire-one-now, 169 auto. 167/171/172 each answer a few bytes ~2 ms
  later — drain after sending them.
- **Firmware wedge hazard**: an auth command (109/110) that reaches the gun
  without its 32-byte payload in the same USB packet blocks the firmware; if
  its receive banks then fill, writes time out until a physical reset. gun.js
  always sends command+payload in one write (39 bytes < one 64-byte CDC
  packet). Recovery, in order: `unwedge()` (feed it 32 zeros), the 1200-baud
  bootloader touch (`bootloaderTouch()`, works even when wedged), replug.
- Queries: 101 firmware (2 bytes), 102 camera name (15), 111 unique id /
  113 colour / 115 date (variable), 104/105 EEPROM calibration offsets
  (`v*100+10000` big-endian), 54/55 offscreen reload, 60 button map
  (slots 100-140), 183 low-resource mode, 180 calibration mode.

## Camera findings (from sindenrs / sindenrs-macos hardware notes)

- 640x480 MJPEG at **60 fps** (YUYV only 30). macOS decodes MJPEG for us
  (AVFoundation `420v`); Chrome's getUserMedia sits on AVFoundation.
- The camera is mounted **180° rotated** — flip both axes (tracker.js defaults
  to flipped).
- The vendor-reference tuning: **exposure 78** (100 µs units ⇒ 7.8 ms),
  threshold ~48, contrast 50. At that exposure the frame is black except the
  lit screen — a sharp bright quad, ideal for detection.
- **macOS cannot set manual exposure through AVFoundation on external UVC
  cameras** (`isExposureModeSupported(.custom)` = false). Auto-exposure blows
  the screen out to near white. sindenrs-macos had to send raw UVC class
  requests via IOKit — which a web page cannot do (WebUSB blocklists the video
  class, and the device is claimed by the OS anyway). **This is the one open
  feasibility question for the browser driver on macOS.** Candidate answers,
  in test order:
  1. Chrome may still expose `exposureTime`/`brightness`/`contrast` in
     `track.getCapabilities()` on some platforms (it does on Windows/Linux).
     The console page dumps capabilities and applies any control it finds —
     plug the gun in and look.
  2. **Blown-exposure tracking**: with auto-exposure the whole screen saturates
     into one solid bright quad whose outline *is* the border's outer edge.
     tracker.js handles that case (synthetic test "blown exposure" passes,
     same accuracy). Real-world risk: auto-exposure hunts, and bright room
     objects merge with the screen blob. Needs a hardware test.
  3. A one-shot native "tuner": UVC settings **persist across sessions**
     (sindenrs-macos measured it), so a tiny helper run once after plug-in
     (or `sindenrs debug camera` itself) could set exposure 78 and the browser
     just consumes frames. Breaks "no install", but only needs running after
     replug.
  4. Full native fallback: sindenrs-macos already works as a complete macOS
     driver (tracking, overlay border, calibration, recoil; measured ~1.1 %
     mean aim error). Worth installing anyway as the reference against which
     the browser driver is judged.

## Architecture (updated)

Two viable output paths, both driven by the same camera→tracker pipeline:

- **Canvas mode** (for our game pages): aim in canvas coordinates straight into
  the game (synthesised mouse events or a direct engine hook), buttons from
  serial events. No OS cursor, no fullscreen requirement — the in-engine border
  already surrounds the canvas. Needs the game page itself to host the driver
  (camera + serial permission prompts on the game page).
- **Cursor mode** (works for anything): stream positions to the gun over serial
  (command 40) and let the gun's own absolute HID mouse drive the OS cursor;
  trigger arrives as a real left-click at the aim. A separate "driver tab"
  could do this — but the border must then surround the *screen* (fullscreen
  border page or the game's own fullscreen), and the driver tab competes with
  the game for foreground throttling. Browser tabs in the background get
  heavily throttled; rVFC stops — this mode likely needs the driver in a
  visible window or a worker. Treat as a stretch goal.

Tracking: `tracker.js` (plain border, all four edges visible) measures
0.35–0.75 % synthetic aim error at 0.3–2 ms/frame (320x240). The sindenrs
*coded* border (position-encoding tabs; solves from partial views, immune to
roll) is the proven next step if partial-border robustness is needed — its
vision code is MIT Rust and could compile to WASM rather than be rewritten.

## Near term: harden the current mouse-based input (unchanged, still to do)

- [x] Confirm how gun input is currently wired: SDL absolute mouse; both game
      tables map left = trigger, right/middle = pedal, key 5 = coin, R held =
      aim off-screen (`timecris/src/tc_game.c`, `tc2/src/tc2_input.c`).
- [x] Use absolute pointer position (clientX/clientY), not Pointer Lock / movementX
      (`sinden/aim.js` re-dispatches the gun's events corrected and smoothed).
- [x] Map pointer coordinates to canvas space correctly at any canvas size and scale
      (fullscreen: the driver maps the border round the 4:3 box to the whole screen).
- [x] Block the browser context menu: both game pages now suppress it
      page-wide (the pedal is right click, and the gun drifts off the canvas
      mid-press), not just on the canvas.
- [x] Add a fullscreen mode (F11 / the button: a 4:3 wrapper, never the
      engine's own 16:9 fullscreen). The 9-point calibration is fitted fullscreen.

**Native driver status (Tom's machine):** Sindenrs.app installed and configured
for these games — `~/.config/sindenrs/config.toml` maps trigger=left click,
pump/front=right/middle (pedal), rear-right=5 (coin), rear-left=R (off-screen
aim), recoil on at 80. The menu bar item (scope icon) now has Calibrate… /
Edit Settings… / Reload Settings. With it running, the gun plays these pages
through the normal mouse path; quit it (⌃⌥⌘Q) before using `web/sinden/`,
which needs the same serial port and camera.

## Platform expectations (updated)

| Platform | Camera | Buttons | Expected result |
|---|---|---|---|
| Windows / Linux / ChromeOS (Chrome, Edge) | getUserMedia; exposure controls likely available | Web Serial | Good |
| macOS (Chrome, Edge) | getUserMedia 640x480@60; **manual exposure probably unavailable** — see the four candidate answers above | Web Serial | The open question |
| Android (Chrome) | External USB camera support is device-dependent | Web Serial (148+) or WebUSB polyfill (serial only — the camera class is blocklisted) | Device-dependent |
| iPhone / iPad | n/a | No serial or USB access in WebKit | Not supported |

## Tasks

**Phase 0: feasibility — console built, hardware pass pending**

- [x] Test page: cameras via enumerateDevices, live feed, getCapabilities dump,
      apply whatever controls exist (`web/sinden/index.html`, headless-tested
      with Chrome's fake camera).
- [x] What the control device enumerates as on macOS: answered by
      sindenrs-macos (`16c0:0f01`, `/dev/cu.usbmodemHIDDO1`); Chrome's Web
      Serial picker lists CDC-ACM devices — verify with the real gun.
- [ ] **With the gun plugged in (Chrome on macOS):** open `web/sinden/` over
      localhost, then: does the Sinden camera appear and deliver 640x480@60?
      does getCapabilities offer exposure/brightness/contrast, and do they
      apply? does the serial picker list the gun, does AUTHENTICATE pass, do
      trigger pulls print, does TEST SHOT kick, does POSITION: SWEEP move the
      macOS cursor? then FULLSCREEN BORDER TEST + run tracker: solve rate and
      aim stability at auto exposure (the blown-exposure question).
- [ ] Repeat on an Android phone in Chrome.

**Phase 1: protocol — done** (adopted from sindenrs, MIT, clean-room; gun.js
ports it; known-answer auth vectors pass in `web/test/sinden-test.js`).
Optional courtesies: email Sinden anyway; upstream anything new we learn.

**Phase 2: tracking prototype — prototype done, hardening pending**

- [x] Border detection + homography on frames; synthetic accuracy 0.35–0.75 %
      at 0.3–2 ms/frame.
- [ ] Measure on live camera frames (desktop + phone): solve rate, latency
      end-to-end (screen flash → detection).
- [ ] Calibration flow (shoot a centre target, store offset; the gun's EEPROM
      bore via commands 104/105 is readable already).
- [ ] Low-resource mode: process only on trigger pull / reduced rate
      (command 183 relates on the gun side).
- [ ] If partial-border robustness is needed: evaluate compiling sindenrs's
      vision crate (coded border) to WASM instead of extending tracker.js.

**Phase 3: integration into the game pages**

- [ ] Input abstraction: official-app/OS-mouse path vs in-browser driver.
- [ ] Wire aim + trigger into the Time Crisis canvas (SDL synthesised events
      or direct engine hook), offscreen reload behaviour.
- [ ] Recoil on trigger (gun-side, already firmware-driven once configured).
- [ ] Two-player: two cameras + two serial ports (pair by camera name,
      command 102, vs getUserMedia label).
- [ ] Per-browser capability detection with clear fallbacks and messages.

### Licence position

sindenrs and sindenrs-macos are MIT: protocol facts and code are usable with
attribution (gun.js carries it). Sinden's own software remains closed and
unredistributable — nothing here derives from it. Clean-room status is
inherited from sindenrs's documented own-hardware reverse engineering.

### References

- sindenrs (clean-room driver, protocol notes): https://github.com/schlarpc/sindenrs
- sindenrs-macos (macOS port, AVFoundation/UVC/IOKit notes): https://github.com/TheBrinkOfTomorrow/sindenrs-macos
- batocera-sinden-recoil (independent recoil protocol notes): https://github.com/Nicoski-lab/batocera-sinden-recoil
- Sinden wiki FAQ: https://www.sindenwiki.org/wiki/FAQ
- Sinden MiSTer driver: https://github.com/MrLightgun/MiSTerSindenDriver
- Web Serial API: https://github.com/wicg/serial/
- Web Serial polyfill (WebUSB): https://github.com/google/web-serial-polyfill
- Android external USB cameras: https://source.android.com/docs/core/camera/external-usb-cameras

## Steam Deck log (native driver path)

The Deck runs the user's `sindenrs` fork as a user service (`sindenrs.service`,
not enabled: `systemctl --user start sindenrs.service` before playing). The gun
is an ordinary absolute mouse to Chrome; the pages do the rest.

- **2026-10-12** — PR #1: `sinden/aim.js` (affine correction fitted from a
  9-point calibration + One Euro smoothing, cursor hidden, context menu
  blocked) and the `/calibrate/` suite. PR #2: every game fullscreen at its
  original 4:3 with the gun border round the 4:3 box; the driver runs with
  `aspect = 1.3333` and its overlay off (the games draw the border).
- **2026-10-14** — PR #3: cache-busting (`aim.js?v=N`, bump on every change;
  `sinden/.htaccess`), the Time Crisis frame made to fill the 4:3 canvas
  (`aspect = stretch`), calibration sounds + a shooting gallery. PR #4: the
  pages fullscreen a wrapper so SDL cannot resize the canvas to 16:9;
  `sinden/deploy.sh` uploads the lot. PR #5 (open): a black 2 % gap inside the
  white border — TC2's bright scenery merged with the border and the aim froze
  ("clipped" in the driver log).
- **2026-10-20** — played the live site with the gun: works. PR #6 (open,
  stacked on #5): Space = the pedal for a gun without one (Time Crisis: the
  page binds `key_pedal = Space`, `key_trigger = Return` in the engine cfg;
  HotD2: Space is a complete off-screen reload shot). Verified headless on the
  Deck: engine Controls page, `test/aim-browser-test.js` for both TC games,
  and HotD2's input block.
- **2026-10-20, later** — #5 and #7 (#6 reopened against main) merged and
  deployed. The driver froze the aim for 14 minutes: its corrupt-frame test
  rejected any MJPEG frame under 60 % of the median of recent *accepted*
  frames, and legitimate frames range 7–58 KB, so it locked out for good.
  Fixed in the sindenrs fork (end-of-image marker + V4L2 error flag instead;
  commit 7402be7 on `steamos`); lens k1 refitted to -0.2102 from a recorded
  minute of play. PR #8: a CRT look (`sinden/crt.js`, F9: off / 100 / 85 /
  70 / 55 % picture brightness) drawn over the canvas with the border passed
  through, so a dimmer picture gives the camera more contrast, not less;
  HotD2 now fullscreens a wrapper like the TC pages.
- Next: the Decky plugin (`decky-sinden`) to start the driver from Game Mode
  is untested on the device. Aim at the bottom/edges: a homography fit from
  the 9 calibration points would absorb screen tilt (aim.js fits an affine).
