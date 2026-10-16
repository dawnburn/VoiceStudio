import { Store } from '@tanstack/store';
import { useStore } from '@tanstack/react-store';
import { describeMicError, type MicErrorDescription } from '@/lib/audio/recorder';

// Live voice changer: microphone → pitch/robot worklet → tone and radio
// filters → echo → output device. The whole graph runs in the renderer's Web
// Audio engine, so it behaves the same on macOS, Windows and Linux and sends
// nothing off the machine. The engine lives at module scope so the voice
// keeps changing while the user moves around the app (e.g. during a call).

export const WORKLET_URL = '/voice-changer-worklet.js';

export type VoiceSettings = {
  /** Semitones, -12..12. */
  pitch: number;
  /** Darker (-1) to brighter (1). */
  tone: number;
  /** Ring-modulation depth, 0..1. */
  robot: number;
  radio: boolean;
  /** Echo amount, 0..1. */
  echo: number;
  /** Output volume, 0..1.5. */
  volume: number;
};

export const PRESETS = {
  natural: { pitch: 0, tone: 0, robot: 0, radio: false, echo: 0 },
  deep: { pitch: -5, tone: -0.3, robot: 0, radio: false, echo: 0 },
  higher: { pitch: 5, tone: 0.2, robot: 0, radio: false, echo: 0 },
  chipmunk: { pitch: 10, tone: 0.3, robot: 0, radio: false, echo: 0 },
  giant: { pitch: -10, tone: -0.5, robot: 0, radio: false, echo: 0.2 },
  robot: { pitch: -2, tone: 0, robot: 1, radio: false, echo: 0 },
  radio: { pitch: 0, tone: 0.3, robot: 0, radio: true, echo: 0 },
  cave: { pitch: -2, tone: -0.2, robot: 0, radio: false, echo: 0.6 },
} as const satisfies Record<string, Omit<VoiceSettings, 'volume'>>;
export type PresetId = keyof typeof PRESETS;

export type VoiceChangerState = {
  status: 'idle' | 'starting' | 'running';
  error: MicErrorDescription | null;
  settings: VoiceSettings;
  inputId: string;
  outputId: string;
};

const initial = (): VoiceChangerState => ({
  status: 'idle',
  error: null,
  settings: { ...PRESETS.natural, volume: 1 },
  inputId: '',
  outputId: '',
});
export const voiceChanger = new Store<VoiceChangerState>(initial());
export const useVoiceChanger = () => useStore(voiceChanger);

export const semitonesToRatio = (semitones: number) => 2 ** (semitones / 12);

/** Filter and gain targets for a settings value — pure so it can be tested. */
export function graphTargets(settings: VoiceSettings) {
  return {
    pitchRatio: semitonesToRatio(Math.max(-12, Math.min(12, settings.pitch))),
    robot: Math.max(0, Math.min(1, settings.robot)),
    lowShelfDb: -settings.tone * 6,
    highShelfDb: settings.tone * 9,
    highpassHz: settings.radio ? 400 : 20,
    lowpassHz: settings.radio ? 3200 : 20000,
    echoWet: settings.echo * 0.7,
    echoFeedback: settings.echo * 0.45,
    volume: Math.max(0, Math.min(1.5, settings.volume)),
  };
}

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
type Graph = {
  context: SinkContext;
  stream: MediaStream;
  worklet: AudioWorkletNode;
  lowShelf: BiquadFilterNode;
  highShelf: BiquadFilterNode;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  echoWet: GainNode;
  echoFeedback: GainNode;
  volume: GainNode;
};
class StartError extends Error {
  constructor(readonly description: MicErrorDescription) {
    super(description.key);
  }
}

let graph: Graph | null = null;
let generation = 0;

/** Chromium can route an AudioContext to a chosen output (e.g. a virtual cable). */
export const supportsOutputSelection = () =>
  typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

function apply(target: Graph, settings: VoiceSettings) {
  const values = graphTargets(settings);
  const now = target.context.currentTime;
  const glide = (param: AudioParam, value: number) => param.setTargetAtTime(value, now, 0.02);
  target.worklet.parameters.get('pitchRatio')?.setValueAtTime(values.pitchRatio, now);
  target.worklet.parameters.get('robot')?.setValueAtTime(values.robot, now);
  glide(target.lowShelf.gain, values.lowShelfDb);
  glide(target.highShelf.gain, values.highShelfDb);
  glide(target.highpass.frequency, values.highpassHz);
  glide(target.lowpass.frequency, values.lowpassHz);
  glide(target.echoWet.gain, values.echoWet);
  glide(target.echoFeedback.gain, values.echoFeedback);
  glide(target.volume.gain, values.volume);
}

async function teardown(target: Graph) {
  target.stream.getTracks().forEach((track) => track.stop());
  try {
    await target.context.close();
  } catch {
    /* already closed */
  }
}

export async function startVoiceChanger() {
  if (voiceChanger.state.status !== 'idle') return;
  const run = ++generation;
  voiceChanger.setState((state) => ({ ...state, status: 'starting', error: null }));
  let stream: MediaStream | null = null;
  let context: SinkContext | null = null;
  try {
    const { inputId, outputId, settings } = voiceChanger.state;
    stream = await navigator.mediaDevices
      .getUserMedia({
        audio: {
          ...(inputId ? { deviceId: { exact: inputId } } : {}),
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      })
      .catch((error: unknown) => {
        throw new StartError(describeMicError(error));
      });
    context = new AudioContext({ latencyHint: 'interactive' }) as SinkContext;
    await context.audioWorklet.addModule(WORKLET_URL);
    if (outputId && context.setSinkId) {
      await context.setSinkId(outputId).catch(() => {
        throw new StartError({ key: 'voice_changer.output_failed' });
      });
    }
    if (context.state === 'suspended') await context.resume();
    if (run !== generation) throw new DOMException('cancelled', 'AbortError');

    const source = context.createMediaStreamSource(stream);
    const rumble = new BiquadFilterNode(context, { type: 'highpass', frequency: 70 });
    const worklet = new AudioWorkletNode(context, 'voice-changer', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const lowShelf = new BiquadFilterNode(context, { type: 'lowshelf', frequency: 250 });
    const highShelf = new BiquadFilterNode(context, { type: 'highshelf', frequency: 3000 });
    const highpass = new BiquadFilterNode(context, { type: 'highpass', frequency: 20 });
    const lowpass = new BiquadFilterNode(context, { type: 'lowpass', frequency: 20000 });
    const delay = new DelayNode(context, { delayTime: 0.28, maxDelayTime: 1 });
    const echoWet = new GainNode(context, { gain: 0 });
    const echoFeedback = new GainNode(context, { gain: 0 });
    // Keeps a sudden clipping burst (e.g. echo build-up) from hurting ears.
    const limiter = new DynamicsCompressorNode(context, {
      threshold: -3,
      knee: 0,
      ratio: 20,
      attack: 0.002,
      release: 0.1,
    });
    const volume = new GainNode(context, { gain: 1 });

    source.connect(rumble).connect(worklet).connect(lowShelf).connect(highShelf);
    highShelf.connect(highpass).connect(lowpass);
    lowpass.connect(limiter);
    lowpass.connect(delay).connect(echoWet).connect(limiter);
    delay.connect(echoFeedback).connect(delay);
    limiter.connect(volume).connect(context.destination);

    graph = {
      context,
      stream,
      worklet,
      lowShelf,
      highShelf,
      highpass,
      lowpass,
      echoWet,
      echoFeedback,
      volume,
    };
    apply(graph, settings);
    // A mic unplugged mid-call ends the track; stop instead of going silent.
    stream.getAudioTracks()[0]?.addEventListener('ended', () => void stopVoiceChanger());
    voiceChanger.setState((state) => ({ ...state, status: 'running' }));
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    await context?.close().catch(() => undefined);
    if (run !== generation) return;
    voiceChanger.setState((state) => ({
      ...state,
      status: 'idle',
      error:
        error instanceof StartError
          ? error.description
          : {
              key: 'voice_changer.start_failed',
              params: { message: error instanceof Error ? error.message : String(error) },
            },
    }));
  }
}

export async function stopVoiceChanger() {
  generation += 1;
  const current = graph;
  graph = null;
  voiceChanger.setState((state) => ({ ...state, status: 'idle' }));
  if (current) await teardown(current);
}

export function updateVoiceSettings(patch: Partial<VoiceSettings>) {
  voiceChanger.setState((state) => ({ ...state, settings: { ...state.settings, ...patch } }));
  if (graph) apply(graph, voiceChanger.state.settings);
}

export function applyPreset(id: PresetId) {
  updateVoiceSettings(PRESETS[id]);
}

/** Device changes need a fresh graph; restart only if it was running. */
export async function setVoiceDevice(kind: 'inputId' | 'outputId', id: string) {
  voiceChanger.setState((state) => ({ ...state, [kind]: id }));
  if (kind === 'outputId' && graph?.context.setSinkId) {
    try {
      await graph.context.setSinkId(id);
      return;
    } catch {
      /* fall through to a restart, which reports the failure */
    }
  }
  if (voiceChanger.state.status === 'running') {
    await stopVoiceChanger();
    await startVoiceChanger();
  }
}

export const dismissVoiceChangerError = () =>
  voiceChanger.setState((state) => ({ ...state, error: null }));

export function resetVoiceChangerForTests() {
  generation += 1;
  graph = null;
  voiceChanger.setState(initial);
}
