import { beforeAll, expect, it } from 'vitest';

// Load the real worklet from /public with the AudioWorkletGlobalScope stubbed,
// so the DSP that ships is the DSP under test.
const SAMPLE_RATE = 48000;
type Processor = {
  process: (
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ) => boolean;
};
let Processor: new () => Processor;

beforeAll(async () => {
  const scope = globalThis as Record<string, unknown>;
  scope.AudioWorkletProcessor = class {};
  scope.sampleRate = SAMPLE_RATE;
  scope.registerProcessor = (name: string, ctor: new () => Processor) => {
    if (name === 'voice-changer') Processor = ctor;
  };
  // @ts-expect-error -- plain-JS worklet asset, imported for its registerProcessor side effect
  await import('../../../../../public/voice-changer-worklet.js');
});

function render(frequency: number, ratio: number, robot = 0, seconds = 1) {
  const processor = new Processor();
  const block = 128;
  const total = Math.floor((SAMPLE_RATE * seconds) / block) * block;
  const output = new Float32Array(total);
  for (let start = 0; start < total; start += block) {
    const input = new Float32Array(block);
    for (let i = 0; i < block; i++) {
      input[i] = Math.sin((2 * Math.PI * frequency * (start + i)) / SAMPLE_RATE);
    }
    const out = [new Float32Array(block), new Float32Array(block)];
    processor.process([[input]], [out], {
      pitchRatio: new Float32Array([ratio]),
      robot: new Float32Array([robot]),
    });
    expect(out[1]).toEqual(out[0]);
    output.set(out[0], start);
  }
  return output;
}

/** Strongest frequency by scanning single-bin DFT magnitudes. */
function dominant(signal: Float32Array, from: number, to: number) {
  const tail = signal.subarray(signal.length / 2); // skip the crossfade-in
  let best = 0;
  let bestPower = -1;
  for (let f = from; f <= to; f += 2) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < tail.length; n++) {
      const angle = (2 * Math.PI * f * n) / SAMPLE_RATE;
      re += tail[n] * Math.cos(angle);
      im += tail[n] * Math.sin(angle);
    }
    const power = re * re + im * im;
    if (power > bestPower) {
      bestPower = power;
      best = f;
    }
  }
  return best;
}

it('passes audio through unchanged at 0 semitones', () => {
  const output = render(220, 1);
  const tail = output.subarray(output.length - 1000);
  for (let i = 0; i < tail.length; i++) {
    const n = output.length - 1000 + i;
    expect(tail[i]).toBeCloseTo(Math.sin((2 * Math.PI * 220 * n) / SAMPLE_RATE), 5);
  }
});

it.each([
  [2 ** (7 / 12), 220 * 2 ** (7 / 12)],
  [2 ** (-5 / 12), 220 * 2 ** (-5 / 12)],
])('shifts a 220 Hz tone by ratio %f', (ratio, expected) => {
  // The delay sweep crossfades every |1 - ratio| * rate / window samples, which
  // puts sidebands that far either side of the shifted tone; the peak must land
  // within one sweep of the target and well clear of the original 220 Hz.
  const sweep = (Math.abs(1 - ratio) * SAMPLE_RATE) / Math.round(SAMPLE_RATE * 0.04);
  const peak = dominant(render(220, ratio), 100, 500);
  expect(Math.abs(peak - expected)).toBeLessThanOrEqual(sweep + 2);
  expect(Math.abs(peak - 220)).toBeGreaterThan(40);
});

it('stays bounded and finite with every effect at full', () => {
  const output = render(440, 2, 1);
  expect(output.every((value) => Number.isFinite(value) && Math.abs(value) <= 1.0001)).toBe(true);
});
