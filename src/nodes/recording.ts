import type { Duration } from '../api';
import { defineNode } from '../define';
import { LOOPER, RECORDER } from '../worklets/processors';

const isOffline = (context: BaseAudioContext): context is OfflineAudioContext =>
  typeof (context as OfflineAudioContext).startRendering === 'function';

const channelsOf = (init: Readonly<Record<string, unknown>>): 1 | 2 =>
  init['channels'] === 1 ? 1 : 2;

const workletOptions = (channels: number): AudioWorkletNodeOptions => ({
  numberOfInputs: 1,
  numberOfOutputs: 1,
  outputChannelCount: [channels],
  channelCount: channels,
  channelCountMode: 'explicit',
  channelInterpretation: 'speakers',
});

/**
 * Browsers may not run a node whose output goes nowhere. A silent connection to the destination keeps
 * a recorder or looper running even when nothing is chained after it.
 */
function keepRunning(context: BaseAudioContext, node: AudioNode): GainNode {
  const silent = new GainNode(context, { gain: 0 });
  node.connect(silent).connect(context.destination);
  return silent;
}

const LATENCY = {
  default: 0,
  min: 0,
  max: 1,
  unit: 'seconds',
  rate: 'control',
  description:
    'Seconds by which the input arrives late (the time through the audio interface and back). What is recorded is shifted earlier by this much, so an overdub lines up with what the player heard.',
} as const;

/**
 * Gate changes are scheduled by sample number, not by time. A time such as 0.1 + 0.2 is a hair past
 * the sample it means, which would move the change one sample late; naming a point a quarter of a
 * sample before the wanted one lands on it exactly in every browser.
 */
class Gate {
  constructor(
    private param: AudioParam,
    private sampleRate: number,
  ) {}

  frame(seconds: number): number {
    return Math.max(0, Math.round(seconds * this.sampleRate));
  }

  set(value: number, frame: number): void {
    this.param.setValueAtTime(value, Math.max(0, (frame - 0.25) / this.sampleRate));
  }

  /** Raises the gate. A one-sample dip first makes sure a gate that is already high rises again. */
  raise(frame: number): void {
    if (frame > 0) this.set(0, frame - 1);
    this.set(1, frame);
  }

  /** A short pulse, for gates that act on their rising edge. */
  pulse(frame: number): void {
    this.set(1, frame);
    this.set(0, frame + 2);
  }
}

export const recorder = defineNode({
  type: 'recorder',
  category: 'io',
  description:
    'Records whatever passes through it into the buffer store, exact to the sample. Start with trigger() and stop with release(), or give trigger a duration. The recording appears under the key named by `into`, where a sampler can play it. Recorders triggered at the same time produce recordings that line up exactly, which is how stems are made.',
  triggerable: true,
  params: { latency: LATENCY },
  options: {
    into: {
      type: 'string',
      description:
        "Buffer store key the recording is written to. Each new take replaces the last. Default: the node's id.",
    },
    channels: { type: '1 | 2', default: '2', description: 'Mono or stereo.' },
  },
  triggerOptions: {
    duration: { type: 'seconds', description: 'Stops by itself after this long.' },
    key: { type: 'string', description: 'Store key for this take, instead of `into`.' },
  },
  build(context, init) {
    const audio = context.audio;
    const channels = channelsOf(init);
    const node = context.worklet(RECORDER, {
      ...workletOptions(channels),
      processorOptions: isOffline(audio) ? { endFrame: audio.length } : {},
    });
    const gate = new Gate(node.parameters.get('record')!, audio.sampleRate);
    const silent = keepRunning(audio, node);
    const defaultKey = typeof init['into'] === 'string' ? init['into'] : context.id;
    // Made now, so a sampler can name the key before the first take exists.
    context.bufferSink(defaultKey);

    let latency = 0;
    /** Keys of takes that have been scheduled but not yet started, in time order. */
    const scheduled: { at: number; key: string }[] = [];
    const takes = new Map<number, { key: string; chunks: Float32Array[][] }>();

    node.port.onmessage = (event: MessageEvent) => {
      const message = event.data as { take: number; data: Float32Array[]; last: boolean };
      let take = takes.get(message.take);
      if (!take) {
        take = { key: scheduled.shift()?.key ?? defaultKey, chunks: [] };
        takes.set(message.take, take);
      }
      if (message.data.length > 0) take.chunks.push(message.data);
      if (!message.last) return;
      takes.delete(message.take);
      const length = take.chunks.reduce((sum, chunk) => sum + chunk[0]!.length, 0);
      if (length === 0) return;
      const buffer = new AudioBuffer({
        length,
        numberOfChannels: channels,
        sampleRate: audio.sampleRate,
      });
      for (let channel = 0; channel < channels; channel++) {
        const target = buffer.getChannelData(channel);
        let offset = 0;
        for (const chunk of take.chunks) {
          target.set(chunk[channel]!, offset);
          offset += chunk[channel]!.length;
        }
      }
      context.bufferSink(take.key).write(buffer);
    };

    return {
      input: node,
      output: node,
      params: {
        latency(value) {
          latency = value as number;
        },
      },
      trigger(options, at) {
        const start = gate.frame(at + latency);
        const key = typeof options['key'] === 'string' ? options['key'] : defaultKey;
        if (key !== defaultKey) context.bufferSink(key);
        gate.raise(start);
        scheduled.push({ at: start, key });
        scheduled.sort((a, b) => a.at - b.at);
        const duration = options['duration'];
        if (typeof duration === 'number' && duration > 0) {
          gate.set(0, start + Math.max(1, gate.frame(duration)));
        }
      },
      release(_options, at) {
        gate.set(0, gate.frame(at + latency));
      },
      dispose() {
        node.port.onmessage = null;
        node.disconnect();
        silent.disconnect();
      },
    };
  },
});

export const looper = defineNode({
  type: 'looper',
  category: 'io',
  description:
    'Records a loop from its input and plays it round and round, in time. The first trigger() records one loop of the given length; each later trigger() adds a layer on top. call("undo") removes the newest layer, call("clear") empties it, and call("stop") and call("play") silence and restore playback without losing the place. Start the first layer on a bar line and the loop stays on the bar for as long as the tempo does not change.',
  triggerable: true,
  params: {
    gain: {
      default: 1,
      min: 0,
      max: 2,
      rate: 'audio',
      description: 'Level of the loop playback.',
    },
    monitor: {
      default: 1,
      min: 0,
      max: 2,
      rate: 'audio',
      description: 'Level of the input passed straight through. 0 lets only the loop out.',
    },
    overdub: {
      default: 0.7,
      min: 0,
      max: 1,
      rate: 'audio',
      description:
        'Level at which layers after the first are recorded. Below 1 so that layers stacked on each other do not add up to distortion. Read when a layer starts.',
    },
    latency: LATENCY,
  },
  options: {
    length: {
      type: 'duration',
      default: "'1 bar'",
      description:
        "How long the loop is, such as '2 bars' or '1/2'. Read when the first layer is recorded, at the tempo of that moment.",
    },
    channels: { type: '1 | 2', default: '2', description: 'Mono or stereo.' },
  },
  triggerOptions: {
    length: {
      type: 'duration',
      description: 'Loop length, when this trigger records the first layer.',
    },
    cycles: {
      type: 'number',
      default: '1',
      description: 'How many times round the loop to record. 0 records until release().',
    },
  },
  build(context, init) {
    const audio = context.audio;
    const node = context.worklet(LOOPER, workletOptions(channelsOf(init)));
    const param = (name: string): AudioParam => node.parameters.get(name)!;
    const silent = keepRunning(audio, node);
    const gate = (name: string): Gate => new Gate(param(name), audio.sampleRate);
    const record = gate('record');

    let latency = 0;
    /** The loop's length in seconds once a first layer has been asked for; null while it is empty. */
    let loopSeconds: number | null = null;
    let layers = 0;

    return {
      input: node,
      output: node,
      params: {
        gain: param('gain'),
        monitor: param('monitor'),
        overdub: param('overdub'),
        latency(value, at) {
          latency = value as number;
          param('latency').setValueAtTime(latency, at);
        },
      },
      trigger(options, at) {
        if (loopSeconds === null) {
          const length = (options['length'] ?? init['length'] ?? '1 bar') as Duration;
          loopSeconds = Math.min(120, Math.max(0.001, context.seconds(length)));
          // Set at once, not at `at`: the processor reads the length at the start of the block in
          // which recording begins, which is slightly before `at`.
          param('length').setValueAtTime(loopSeconds, 0);
        }
        layers++;
        const start = record.frame(at + latency);
        record.raise(start);
        const cycles = typeof options['cycles'] === 'number' ? options['cycles'] : 1;
        if (cycles > 0) {
          record.set(0, start + Math.round(cycles * loopSeconds * audio.sampleRate));
        }
      },
      release(_options, at) {
        record.set(0, record.frame(at + latency));
      },
      methods: {
        undo(_args, at) {
          gate('undo').pulse(record.frame(at));
          layers = Math.max(0, layers - 1);
          if (layers === 0) loopSeconds = null;
        },
        clear(_args, at) {
          gate('clear').pulse(record.frame(at));
          record.set(0, record.frame(at));
          layers = 0;
          loopSeconds = null;
        },
        stop(_args, at) {
          gate('play').set(0, record.frame(at));
        },
        play(_args, at) {
          gate('play').set(1, record.frame(at));
        },
      },
      dispose() {
        node.disconnect();
        silent.disconnect();
      },
    };
  },
});

export const input = defineNode({
  type: 'input',
  category: 'io',
  description:
    'Live audio from a microphone or audio interface. The browser asks the person for permission the first time; until they answer, and if they refuse, the node is silent. Live engines only: an offline render has no microphone.',
  shorthand: 'gain',
  params: {
    gain: { default: 1, min: 0, max: 4, rate: 'audio', description: 'Input level.' },
  },
  options: {
    deviceId: {
      type: 'string',
      description:
        'Which input device, as listed by navigator.mediaDevices.enumerateDevices(). Default: the system input.',
    },
    stream: {
      type: 'MediaStream',
      description: 'A stream the page already has, used instead of asking for the microphone.',
    },
    processing: {
      type: 'boolean',
      default: 'false',
      description:
        "Leaves the browser's echo cancellation, noise suppression and automatic gain on. They suit speech and spoil music, so they are off unless asked for.",
    },
  },
  build(context, init) {
    const audio = context.audio;
    if (isOffline(audio)) {
      throw new Error('an offline engine has no live input. Use a sampler with recorded audio.');
    }
    const live = audio as AudioContext;
    const out = new GainNode(audio);
    let source: MediaStreamAudioSourceNode | null = null;
    /** A stream this node asked for itself, which it must also stop. */
    let owned: MediaStream | null = null;
    let disposed = false;

    const attach = (stream: MediaStream): void => {
      if (disposed) return;
      source = live.createMediaStreamSource(stream);
      source.connect(out);
    };

    const given = init['stream'];
    if (typeof MediaStream !== 'undefined' && given instanceof MediaStream) {
      attach(given);
    } else if (!navigator.mediaDevices?.getUserMedia) {
      context.report('this browser or page cannot use audio input (it needs a secure https page).');
    } else {
      const processing = init['processing'] === true;
      const deviceId = init['deviceId'];
      navigator.mediaDevices
        .getUserMedia({
          audio: {
            ...(typeof deviceId === 'string' ? { deviceId: { exact: deviceId } } : {}),
            echoCancellation: processing,
            noiseSuppression: processing,
            autoGainControl: processing,
          },
        })
        .then(
          (stream) => {
            if (disposed) {
              for (const track of stream.getTracks()) track.stop();
              return;
            }
            owned = stream;
            attach(stream);
          },
          (error: unknown) =>
            context.report(
              `could not open the audio input (${error instanceof Error ? error.message : String(error)}).`,
              error,
            ),
        );
    }

    return {
      output: out,
      params: { gain: out.gain },
      dispose() {
        disposed = true;
        source?.disconnect();
        out.disconnect();
        if (owned) for (const track of owned.getTracks()) track.stop();
      },
    };
  },
});
