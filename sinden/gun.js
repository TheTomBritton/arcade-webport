// Sinden lightgun over Web Serial: a clean-room driver for the gun's control
// device (CDC-ACM serial, 115200 8N1).
//
// The wire protocol here is implemented from the MIT-licensed clean-room notes
// and driver by Chaz Schlarp — https://github.com/schlarpc/sindenrs — which
// documents it as: every host-to-gun message is a fixed 7-byte frame
// `AA cmd p1 p2 p3 p4 BB`; replies are raw bytes of a length implied by the
// command; the gun emits unsolicited events (buttons, calibration) only after
// command 50 ("secondary serial output") enables them. Streaming is gated on a
// mutual SHA-256 handshake whose two secrets are fixed constants in every
// vendor driver build; they are included here for interoperability so hardware
// the user owns works from the browser.
//
// FIRMWARE HAZARD (from the sindenrs notes): if an auth command (109/110)
// reaches the gun without its 32-byte payload in the same USB packet, the
// firmware blocks in a fixed-length read and eventually stops servicing USB
// writes entirely. So command + payload are always sent in ONE write here
// (39 bytes < the 64-byte CDC packet size). Recovery, in order: feed the
// pending read 32 zero bytes (unwedge()), or the Leonardo 1200-baud bootloader
// touch (bootloaderTouch()), or physically replug the gun.
'use strict';

const SindenGun = (() => {

  const HEADER = 0xAA, TRAILER = 0xBB;
  const BAUD = 115200;
  const POSITION_MAX = 32767;

  // Command bytes, decimal as in the vendor source (per sindenrs).
  const CMD = {
    POSITION: 40,
    POSITION_TRIGGER_LATCH: 41,
    SECONDARY_SERIAL_ON: 50,
    SECONDARY_SERIAL_OFF: 51,
    OFFSCREEN_RELOAD_ON: 54,
    OFFSCREEN_RELOAD_OFF: 55,
    BUTTON_MAP: 60,
    FIRMWARE_VERSION: 101,
    CAMERA_NAME_READ: 102,
    CALIBRATION_X_READ: 104,
    CALIBRATION_Y_READ: 105,
    CALIBRATION_X_WRITE: 106,
    CALIBRATION_Y_WRITE: 107,
    AUTH_HOST_CHALLENGE: 109,
    AUTH_GUN_CHALLENGE: 110,
    UNIQUE_ID: 111,
    FACTORY_COLOUR: 113,
    MANUFACTURE_DATE: 115,
    STREAM_START: 121,
    RECOIL_ENABLE: 161,
    RECOIL_AUTO_PARAMS: 162,
    RECOIL_TRIGGER_MODE: 163,
    RECOIL_EVENTS: 164,
    RECOIL_BUTTONS: 165,
    RECOIL_STRENGTH: 167,
    RECOIL_TEST_SHOT: 168,
    RECOIL_TEST_AUTO: 169,
    RECOIL_TIMING: 171,
    RECOIL_STRENGTH_EXT: 172,
    CALIBRATION_MODE_ENABLE: 180,
    RECOIL_TOGGLE_ENABLE: 181,
    JOYSTICK_MODE: 182,
    LOW_RESOURCE_MODE: 183,
    JOYSTICK_PROBE: 184,
  };

  // Interoperability constants, present in every vendor driver build (sindenrs).
  const GUN_SECRET = 'SindenLightgun364294735243894HaveANiceDay';
  const HOST_SECRET = '60341663085532170074617363215964';

  const te = new TextEncoder();

  function frame(cmd, p = [0, 0, 0, 0]) {
    return new Uint8Array([HEADER, cmd & 0xFF, p[0] & 0xFF, p[1] & 0xFF, p[2] & 0xFF, p[3] & 0xFF, TRAILER]);
  }
  const flagFrame = (cmd, on) => frame(cmd, [on ? 1 : 0, 0, 0, 0]);

  function percentToAxis(pct) {
    pct = Math.min(100, Math.max(0, pct));
    return Math.round(pct / 100 * POSITION_MAX);
  }

  function positionFrame(x, y) {
    x = Math.min(POSITION_MAX, Math.max(0, x | 0));
    y = Math.min(POSITION_MAX, Math.max(0, y | 0));
    return frame(CMD.POSITION, [x >> 8, x & 0xFF, y >> 8, y & 0xFF]);
  }

  // Calibration offsets live in the gun's EEPROM as `v*100 + 10000`, big-endian.
  function calibrationEncode(percent) {
    const v = Math.round(Math.min(99, Math.max(-99, percent)) * 100) + 10000;
    return [v >> 8, v & 0xFF];
  }
  function calibrationDecode(hi, lo) {
    const v = (((hi & 0xFF) << 8) | (lo & 0xFF)) - 10000;
    const pct = v / 100;
    return Math.abs(pct) > 99 ? 0 : pct;
  }

  async function sha256(...parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const buf = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return new Uint8Array(digest);
  }

  const expectedGunResponse = (nonce) => sha256(nonce, te.encode(GUN_SECRET));
  const hostResponse = (challenge) => sha256(challenge, te.encode(HOST_SECRET));

  function makeNonce() {
    const n = new Uint8Array(32);
    crypto.getRandomValues(n);
    return n;
  }

  // --- Unsolicited gun-to-host events (after command 50) ----------------------

  // Incremental parser: a 0xFE button report is 4 bytes (FE state1 state2 96)
  // and may arrive split across reads.
  class EventParser {
    constructor() { this.pending = []; }
    feed(bytes) {
      for (const b of bytes) this.pending.push(b);
      const out = [];
      let i = 0;
      while (i < this.pending.length) {
        const b = this.pending[i];
        if (b === 254) {
          if (this.pending.length < i + 4) break; // wait for the rest
          out.push({ type: 'buttons', state1: this.pending[i + 1], state2: this.pending[i + 2], extra: this.pending[i + 3] });
          i += 4;
          continue;
        }
        if (b === 200) out.push({ type: 'enteredCalibration' });
        else if (b === 201) out.push({ type: 'calibrationSet' });
        else if (b === 202) out.push({ type: 'exitedCalibration' });
        else if (b === 120) out.push({ type: 'triggerEnabled' });
        else out.push({ type: 'unknown', byte: b });
        i++;
      }
      this.pending.splice(0, i);
      return out;
    }
  }

  // Button bits (default map, from the sindenrs hardware notes):
  // state1: 0 trigger, 1 pump, 2 front-left, 3 front-right, 4 rear-left, 5 rear-right
  // state2: 0 d-up, 1 d-down, 2 d-left, 3 d-right
  const BUTTON_NAMES_1 = ['trigger', 'pump', 'frontLeft', 'frontRight', 'rearLeft', 'rearRight'];
  const BUTTON_NAMES_2 = ['dpadUp', 'dpadDown', 'dpadLeft', 'dpadRight'];
  function buttonsFromStates(state1, state2) {
    const held = {};
    BUTTON_NAMES_1.forEach((n, i) => { held[n] = !!(state1 & (1 << i)); });
    BUTTON_NAMES_2.forEach((n, i) => { held[n] = !!(state2 & (1 << i)); });
    return held;
  }

  // --- Byte queue bridging the Web Serial read pump and fixed-length reads ----

  class ByteQueue {
    constructor() { this.buf = []; this.waiter = null; }
    push(bytes) {
      for (const b of bytes) this.buf.push(b);
      if (this.waiter) { const w = this.waiter; this.waiter = null; w(); }
    }
    clear() { this.buf.length = 0; }
    get length() { return this.buf.length; }
    async take(n, timeoutMs) {
      const deadline = performance.now() + timeoutMs;
      while (this.buf.length < n) {
        const left = deadline - performance.now();
        if (left <= 0) {
          throw new Error(`timed out: wanted ${n} bytes, got ${this.buf.length}`);
        }
        await new Promise((resolve) => {
          this.waiter = resolve;
          setTimeout(resolve, Math.min(left, 50));
        });
        this.waiter = null;
      }
      return new Uint8Array(this.buf.splice(0, n));
    }
  }

  // --- The gun session ---------------------------------------------------------

  class Gun {
    constructor(port) {
      this.port = port;
      this.queue = new ByteQueue();
      this.parser = new EventParser();
      this.eventsLive = false;      // route rx to the event parser instead of the queue
      this.onEvent = null;          // ({type, ...}) when eventsLive
      this.onRaw = null;            // (dir, Uint8Array) tap for logging all traffic
      this.writer = null;
      this._pumpDone = null;
      this.authenticated = false;
    }

    // Ask the user to pick the gun's serial port. The control device is a
    // 16c0:0f01 composite ("SindenLightgun"); older firmware may differ, so the
    // page also offers an unfiltered picker.
    static async requestPort({ filtered = true } = {}) {
      const opts = filtered ? { filters: [{ usbVendorId: 0x16c0 }] } : {};
      return navigator.serial.requestPort(opts);
    }

    async open() {
      await this.port.open({ baudRate: BAUD, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 4096 });
      try { await this.port.setSignals({ dataTerminalReady: true, requestToSend: true }); }
      catch (e) { /* some adapters refuse setSignals; the gun usually works anyway */ }
      this.writer = this.port.writable.getWriter();
      this._pumpDone = this._pump();
    }

    async _pump() {
      while (this.port.readable) {
        const reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!value || !value.length) continue;
            if (this.onRaw) this.onRaw('rx', value);
            if (this.eventsLive) {
              for (const ev of this.parser.feed(value)) {
                if (ev.type === 'buttons') ev.held = buttonsFromStates(ev.state1, ev.state2);
                if (this.onEvent) this.onEvent(ev);
              }
            } else {
              this.queue.push(value);
            }
          }
        } catch (e) {
          // device unplugged or fatal read error: fall through and stop
          if (this.onEvent) this.onEvent({ type: 'disconnected', error: String(e) });
          break;
        } finally {
          reader.releaseLock();
        }
        break;
      }
    }

    async close() {
      this.eventsLive = false;
      try { this.writer && this.writer.releaseLock(); } catch (e) {}
      try { await this.port.close(); } catch (e) {}
    }

    async _write(bytes) {
      if (this.onRaw) this.onRaw('tx', bytes);
      await this.writer.write(bytes);
    }

    send(cmd, p) { return this._write(frame(cmd, p)); }

    // Fixed-length query. Do queries BEFORE enabling button reports: once events
    // are live, replies and events share the line and cannot be told apart.
    async query(cmd, len, timeoutMs = 500) {
      if (this.eventsLive) throw new Error('query() while button events are live would race the event stream');
      this.queue.clear();
      await this.send(cmd);
      return this.queue.take(len, timeoutMs);
    }

    // Variable-length query: read until the line is quiet for `quietMs`.
    async queryVariable(cmd, { max = 64, quietMs = 60, timeoutMs = 500 } = {}) {
      if (this.eventsLive) throw new Error('queryVariable() while button events are live');
      this.queue.clear();
      await this.send(cmd);
      const start = performance.now();
      const out = [];
      let lastRx = null;
      while (performance.now() - start < timeoutMs && out.length < max) {
        if (this.queue.length) {
          out.push(...this.queue.buf.splice(0, this.queue.buf.length));
          lastRx = performance.now();
        } else {
          if (lastRx !== null && performance.now() - lastRx >= quietMs) break;
          await new Promise(r => setTimeout(r, 5));
        }
      }
      return new Uint8Array(out);
    }

    // Both legs of the mutual handshake. ~650 ms: the gun takes ~300 ms per
    // SHA-256. Streaming is refused until this has succeeded.
    async authenticate() {
      // Leg 1 (we challenge the gun). ONE write for command + nonce — see the
      // firmware hazard at the top of this file.
      this.queue.clear();
      const nonce = makeNonce();
      const msg = new Uint8Array(7 + 32);
      msg.set(frame(CMD.AUTH_GUN_CHALLENGE), 0);
      msg.set(nonce, 7);
      await this._write(msg);
      const response = await this.queue.take(32, 2000);
      const want = await expectedGunResponse(nonce);
      if (!want.every((b, i) => b === response[i])) throw new Error('gun failed authentication: bad response to our nonce');

      // Leg 2 (the gun challenges us).
      this.queue.clear();
      await this.send(CMD.AUTH_HOST_CHALLENGE);
      const challenge = await this.queue.take(32, 2000);
      await this._write(await hostResponse(challenge));
      const verdict = await this.queue.take(5, 2000);
      const text = String.fromCharCode(...verdict).trim();
      if (text !== 'true') throw new Error(`gun rejected our authentication: ${JSON.stringify(text)}`);
      this.authenticated = true;
    }

    // Recover a firmware blocked in an auth read: feed it the 32 bytes it wants.
    async unwedge() {
      await this._write(new Uint8Array(32));
      await new Promise(r => setTimeout(r, 500));
      this.queue.clear();
    }

    // Command 121 twice with a gap (vendor uses 150 ms).
    async startStreaming(gapMs = 150) {
      await this.send(CMD.STREAM_START);
      await new Promise(r => setTimeout(r, gapMs));
      await this.send(CMD.STREAM_START);
    }

    async firmwareVersion() {
      const b = await this.query(CMD.FIRMWARE_VERSION, 2);
      return `${b[0]}.${b[1]}`;
    }
    async cameraName() {
      const b = await this.query(CMD.CAMERA_NAME_READ, 15);
      return String.fromCharCode(...b).trim();
    }
    async uniqueId() {
      const b = await this.queryVariable(CMD.UNIQUE_ID);
      return Array.from(b).join('');
    }
    async calibration() {
      const x = await this.query(CMD.CALIBRATION_X_READ, 2);
      const y = await this.query(CMD.CALIBRATION_Y_READ, 2);
      return { x: calibrationDecode(x[0], x[1]), y: calibrationDecode(y[0], y[1]) };
    }

    setPosition(x, y) { return this._write(positionFrame(x, y)); }
    setPositionPercent(xp, yp) { return this.setPosition(percentToAxis(xp), percentToAxis(yp)); }

    setOffscreenReload(on) { return this.send(on ? CMD.OFFSCREEN_RELOAD_ON : CMD.OFFSCREEN_RELOAD_OFF); }

    // Enable the gun's serial button reports (FE s1 s2 96 on every press and
    // release). After this, all rx is routed to the event parser.
    async enableButtonReports() {
      await this.send(CMD.SECONDARY_SERIAL_ON);
      this.eventsLive = true;
      // anything already queued may be the first events
      if (this.queue.length) {
        const left = new Uint8Array(this.queue.buf.splice(0, this.queue.buf.length));
        for (const ev of this.parser.feed(left)) {
          if (ev.type === 'buttons') ev.held = buttonsFromStates(ev.state1, ev.state2);
          if (this.onEvent) this.onEvent(ev);
        }
      }
    }
    async disableButtonReports() {
      await this.send(CMD.SECONDARY_SERIAL_OFF);
      this.eventsLive = false;
    }

    // Recoil. Strength is 0-100 (%), sent as 0-250 to both 167 and 172 as the
    // Windows app does; the kick saturates around wire level 100 (sindenrs
    // measurements). 172 latches: once zeroed, recoil stays dead until re-set.
    async configureRecoil({ enabled = true, strength = 40, repeat = false,
                            onTrigger = true, onTriggerOffscreen = true,
                            gapMs = 5 } = {}) {
      const level = Math.round(Math.min(100, Math.max(0, strength)) * 2.5);
      const frames = [
        frame(CMD.RECOIL_AUTO_PARAMS, [80, 50, 80, 50]),
        flagFrame(CMD.RECOIL_ENABLE, true),
        frame(CMD.RECOIL_STRENGTH, [level, 0, 0, 0]),
        flagFrame(CMD.RECOIL_TRIGGER_MODE, repeat),
        frame(CMD.RECOIL_EVENTS, [onTrigger ? 1 : 0, onTriggerOffscreen ? 1 : 0, 0, 0]),
        frame(CMD.RECOIL_BUTTONS, [0, 0, 0, 0]),
        frame(CMD.RECOIL_TIMING, [4, 4, 4, 0]),
        flagFrame(CMD.RECOIL_ENABLE, enabled),
        frame(CMD.RECOIL_STRENGTH_EXT, [level, 0, 0, 0]),
      ];
      // 167/171/172 answer with a few bytes ~2 ms later; gap + drain keeps them
      // out of the next reply (sindenrs uses 5 ms against the vendor's 100).
      for (const f of frames) {
        await this._write(f);
        await new Promise(r => setTimeout(r, gapMs));
        if (!this.eventsLive) this.queue.clear();
      }
    }
    fireRecoil() { return this.send(CMD.RECOIL_TEST_SHOT); }
    startAutoRecoil() { return this.send(CMD.RECOIL_TEST_AUTO); }
    stopRecoil() { return this._write(flagFrame(CMD.RECOIL_ENABLE, false)); }
  }

  // Reset the gun's ATmega32U4 through its bootloader: open the port at 1200
  // baud with DTR low (the Leonardo touch). Works even with the main loop
  // wedged; the gun re-enumerates within a few seconds.
  async function bootloaderTouch(port) {
    await port.open({ baudRate: 1200 });
    try { await port.setSignals({ dataTerminalReady: false }); } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
    await port.close();
  }

  return {
    Gun, EventParser, bootloaderTouch,
    frame, flagFrame, positionFrame, percentToAxis,
    calibrationEncode, calibrationDecode,
    expectedGunResponse, hostResponse, makeNonce, buttonsFromStates,
    CMD, BAUD, POSITION_MAX, HEADER, TRAILER,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SindenGun;
