import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  PRESETS,
  WORKLET_URL,
  applyPreset,
  graphTargets,
  resetVoiceChangerForTests,
  semitonesToRatio,
  setVoiceDevice,
  startVoiceChanger,
  stopVoiceChanger,
  voiceChanger,
} from './voice-changer-engine';

class FakeParam {
  value = 0;
  setTargetAtTime = vi.fn((value: number) => (this.value = value));
  setValueAtTime = vi.fn((value: number) => (this.value = value));
}
class FakeNode {
  connections: FakeNode[] = [];
  gain = new FakeParam();
  frequency = new FakeParam();
  parameters = new Map([
    ['pitchRatio', new FakeParam()],
    ['robot', new FakeParam()],
  ]);
  constructor(..._args: unknown[]) {}
  connect(node: FakeNode) {
    this.connections.push(node);
    return node;
  }
}
const mock = vi.hoisted(() => ({
  contexts: [] as Array<{ setSinkId: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>,
  addModule: vi.fn(),
  sinkError: null as Error | null,
}));
class FakeContext {
  state = 'running';
  currentTime = 0;
  destination = new FakeNode();
  audioWorklet = { addModule: mock.addModule };
  setSinkId = vi.fn(async () => {
    if (mock.sinkError) throw mock.sinkError;
  });
  close = vi.fn(async () => undefined);
  constructor() {
    mock.contexts.push(this);
  }
  createMediaStreamSource() {
    return new FakeNode();
  }
}
const track = { stop: vi.fn(), addEventListener: vi.fn() };
const getUserMedia = vi.fn();

beforeEach(() => {
  mock.contexts.length = 0;
  mock.sinkError = null;
  mock.addModule.mockResolvedValue(undefined);
  getUserMedia.mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] });
  Object.assign(globalThis, {
    AudioContext: FakeContext,
    AudioWorkletNode: FakeNode,
    BiquadFilterNode: FakeNode,
    DelayNode: FakeNode,
    GainNode: FakeNode,
    DynamicsCompressorNode: FakeNode,
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
});
afterEach(() => {
  resetVoiceChangerForTests();
  vi.clearAllMocks();
});

it('maps semitones to playback ratios', () => {
  expect(semitonesToRatio(12)).toBe(2);
  expect(semitonesToRatio(-12)).toBe(0.5);
  expect(semitonesToRatio(0)).toBe(1);
});

it('derives neutral graph targets for the natural preset', () => {
  expect(graphTargets({ ...PRESETS.natural, volume: 1 })).toMatchObject({
    pitchRatio: 1,
    robot: 0,
    lowShelfDb: -0,
    highShelfDb: 0,
    highpassHz: 20,
    lowpassHz: 20000,
    echoWet: 0,
    echoFeedback: 0,
  });
  const radio = graphTargets({ ...PRESETS.radio, volume: 1 });
  expect([radio.highpassHz, radio.lowpassHz]).toEqual([400, 3200]);
  // Echo feedback below 1 keeps the loop from building up forever.
  expect(graphTargets({ ...PRESETS.cave, echo: 1, volume: 1 }).echoFeedback).toBeLessThan(1);
  expect(graphTargets({ ...PRESETS.natural, pitch: 40, volume: 9 })).toMatchObject({
    pitchRatio: 2,
    volume: 1.5,
  });
});

it('starts the graph with the chosen devices and stops cleanly', async () => {
  voiceChanger.setState((state) => ({ ...state, inputId: 'mic-2', outputId: 'cable' }));
  await startVoiceChanger();
  expect(voiceChanger.state.status).toBe('running');
  expect(getUserMedia).toHaveBeenCalledWith({
    audio: expect.objectContaining({ deviceId: { exact: 'mic-2' }, echoCancellation: true }),
  });
  expect(mock.addModule).toHaveBeenCalledWith(WORKLET_URL);
  expect(mock.contexts[0].setSinkId).toHaveBeenCalledWith('cable');
  await stopVoiceChanger();
  expect(voiceChanger.state.status).toBe('idle');
  expect(track.stop).toHaveBeenCalled();
  expect(mock.contexts[0].close).toHaveBeenCalled();
});

it('reports a denied microphone with the shared recording message', async () => {
  getUserMedia.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
  await startVoiceChanger();
  expect(voiceChanger.state).toMatchObject({
    status: 'idle',
    error: { key: 'recording.mic_denied' },
  });
});

it('reports an unusable output device without blaming the microphone', async () => {
  mock.sinkError = Object.assign(new Error('gone'), { name: 'NotFoundError' });
  voiceChanger.setState((state) => ({ ...state, outputId: 'missing' }));
  await startVoiceChanger();
  expect(voiceChanger.state.error).toEqual({ key: 'voice_changer.output_failed' });
  expect(track.stop).toHaveBeenCalled();
  expect(mock.contexts[0].close).toHaveBeenCalled();
});

it('releases the microphone when stopped while still starting', async () => {
  let resolveModule = () => {};
  mock.addModule.mockReturnValue(new Promise<void>((resolve) => (resolveModule = resolve)));
  const starting = startVoiceChanger();
  await vi.waitFor(() => expect(mock.addModule).toHaveBeenCalled());
  await stopVoiceChanger();
  resolveModule();
  await starting;
  expect(voiceChanger.state).toMatchObject({ status: 'idle', error: null });
  expect(track.stop).toHaveBeenCalled();
});

it('switches output live without restarting the microphone', async () => {
  await startVoiceChanger();
  await setVoiceDevice('outputId', 'headset');
  expect(mock.contexts).toHaveLength(1);
  expect(mock.contexts[0].setSinkId).toHaveBeenLastCalledWith('headset');
  expect(voiceChanger.state.outputId).toBe('headset');
});

it('applies presets while running', async () => {
  await startVoiceChanger();
  applyPreset('chipmunk');
  expect(voiceChanger.state.settings).toMatchObject(PRESETS.chipmunk);
});
