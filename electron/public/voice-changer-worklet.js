// AudioWorklet processor for the live voice changer (Tools → Live voice
// changer). Shifts pitch in real time with two crossfaded delay-line taps
// whose delay sweeps at the rate the pitch ratio needs, then optionally
// ring-modulates the result for the robot effect. Everything runs inside
// the renderer's audio thread; no audio leaves the machine.
//
// Served as a static asset from /public so the AudioContext can load it via
// audioWorklet.addModule('/voice-changer-worklet.js') in both dev and the
// bundled app, the same way aec-worklet.js is loaded.

const WINDOW_SECONDS = 0.04; // sweep window: added latency vs. warble trade-off
const FADE_SECONDS = 0.02; // dry↔shifted crossfade when the pitch crosses 0 semitones
const ROBOT_HZ = 50;

class VoiceChangerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'pitchRatio',
        defaultValue: 1,
        minValue: 0.25,
        maxValue: 4,
        automationRate: 'k-rate',
      },
      { name: 'robot', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    const rate = typeof sampleRate === 'number' ? sampleRate : 48000;
    this._window = Math.max(64, Math.round(rate * WINDOW_SECONDS));
    let size = 1;
    while (size < this._window * 2 + 4) size <<= 1;
    this._buffer = new Float32Array(size);
    this._mask = size - 1;
    this._write = 0;
    this._phase = 0;
    // 0 = dry passthrough, 1 = fully shifted. Two static taps at ratio 1 would
    // comb-filter the voice, so "no shift" bypasses the delay line instead.
    this._wet = 0;
    this._fadeStep = 1 / Math.max(1, rate * FADE_SECONDS);
    this._robotPhase = 0;
    this._robotStep = (2 * Math.PI * ROBOT_HZ) / rate;
  }

  _tap(delay) {
    const position = this._write - 1 - delay;
    const floor = Math.floor(position);
    const fraction = position - floor;
    const a = this._buffer[floor & this._mask];
    const b = this._buffer[(floor + 1) & this._mask];
    return a + (b - a) * fraction;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const input = inputs[0];
    const left = input && input[0];
    const right = input && input[1];
    const ratio = parameters.pitchRatio[0];
    const robot = parameters.robot[0];
    const step = (1 - ratio) / this._window;
    const target = Math.abs(ratio - 1) < 1e-4 ? 0 : 1;
    const out = output[0];
    for (let i = 0; i < out.length; i++) {
      const sample = left ? (right ? (left[i] + right[i]) * 0.5 : left[i]) : 0;
      this._buffer[this._write & this._mask] = sample;
      this._write = (this._write + 1) & 0x3fffffff;

      let phase = this._phase + step;
      phase -= Math.floor(phase); // wrap into [0, 1) for either sweep direction
      this._phase = phase;
      const other = phase < 0.5 ? phase + 0.5 : phase - 0.5;
      // sin² windows of taps half a period apart sum to exactly 1, and each
      // tap is silent at the instant its delay jumps back across the window.
      const gainA = Math.sin(Math.PI * phase) ** 2;
      const shifted =
        this._tap(phase * this._window) * gainA + this._tap(other * this._window) * (1 - gainA);

      if (this._wet < target) this._wet = Math.min(target, this._wet + this._fadeStep);
      else if (this._wet > target) this._wet = Math.max(target, this._wet - this._fadeStep);
      let value = sample + (shifted - sample) * this._wet;

      if (robot > 0) {
        value *= 1 - robot + robot * Math.sin(this._robotPhase);
        this._robotPhase += this._robotStep;
        if (this._robotPhase > 2 * Math.PI) this._robotPhase -= 2 * Math.PI;
      }
      out[i] = value;
    }
    for (let channel = 1; channel < output.length; channel++) output[channel].set(out);
    return true; // keep the processor alive while the graph is connected
  }
}

registerProcessor('voice-changer', VoiceChangerProcessor);
