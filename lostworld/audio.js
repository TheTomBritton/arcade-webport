// Plays the board's audio ring straight out of the game's wasm memory (a
// SharedArrayBuffer). The sound board writes 44.1 kHz stereo s16 frames a
// field at a time and bumps a monotonic counter; this reads behind it.
//
// The board makes audio at the game's pace, which never quite agrees with
// the sound card's clock, and it arrives in bursts. So rather than a fixed
// read pointer the buffer is held near a target depth by playing a touch
// faster or slower (at most 2 %, inaudible), and a buffer that runs dry
// fades the last sample out instead of clicking to silence.
class M3Player extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.target = 3072;            // frames kept in hand: ~70 ms, a late field or two
    this.fill = this.target;       // smoothed depth
    this.pos = 0;                  // fractional read position, in frames ever written
    this.lastL = 0; this.lastR = 0; this.dry = false;
    this.underruns = 0; this.resyncs = 0; this.minFill = Infinity; this.reported = 0;
    this.port.onmessage = e => {
      const { buffer, ring, write, size, rate, speed } = e.data;
      this.ring = new Int16Array(buffer, ring, size * 2);
      this.counter = new Uint32Array(buffer, write, 1);
      this.size = size;
      this.ratio = 44100 / (rate || sampleRate) * (speed || 1);   // board frames per output frame (speed: a board paced faster than its own clock)
      this.pos = Atomics.load(this.counter, 0) - this.target;
      this.ready = true;
    };
  }
  sample(i) {
    const k = (((i % this.size) + this.size) % this.size) * 2;
    return [this.ring[k] / 32768, this.ring[k + 1] / 32768];
  }
  process(inputs, outputs) {
    const out = outputs[0], l = out[0], r = out[1] || out[0];
    if (!this.ready) { l.fill(0); r.fill(0); return true; }
    const write = Atomics.load(this.counter, 0);
    let avail = write - this.pos;
    if (avail > this.size / 2 || avail < -this.size / 2) {   // way off (tab hidden, game paused): jump back to the target
      this.pos = write - this.target; avail = this.target; this.resyncs++;
    }
    this.fill += (avail - this.fill) * 0.02;
    this.minFill = Math.min(this.minFill, avail);
    const rate = this.ratio * (1 + Math.max(-0.02, Math.min(0.02, (this.fill - this.target) / this.target * 0.05)));
    for (let i = 0; i < l.length; i++) {
      if (write - this.pos >= 2) {
        const i0 = Math.floor(this.pos), t = this.pos - i0;
        const [a0, b0] = this.sample(i0), [a1, b1] = this.sample(i0 + 1);
        this.lastL = l[i] = a0 + (a1 - a0) * t;
        this.lastR = r[i] = b0 + (b1 - b0) * t;
        this.pos += rate; this.dry = false;
      } else {
        if (!this.dry) { this.dry = true; this.underruns++; }
        this.lastL *= 0.995; this.lastR *= 0.995;
        l[i] = this.lastL; r[i] = this.lastR;
      }
    }
    if (currentTime - this.reported >= 2) {
      this.reported = currentTime;
      this.port.postMessage({ underruns: this.underruns, resyncs: this.resyncs, fill: Math.round(this.fill), minFill: this.minFill });
      this.minFill = Infinity;
    }
    return true;
  }
}
registerProcessor('m3-player', M3Player);
