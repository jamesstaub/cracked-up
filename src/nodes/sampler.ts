import type { BufferRef, BufferSource } from '../api';
import { defineNode } from '../define';

/** Reversed copies, made once per buffer and dropped with it. */
const reversedCopies = new WeakMap<AudioBuffer, AudioBuffer>();

function reversed(buffer: AudioBuffer): AudioBuffer {
  let copy = reversedCopies.get(buffer);
  if (!copy) {
    copy = new AudioBuffer({
      length: buffer.length,
      numberOfChannels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
    });
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      copy.copyToChannel(buffer.getChannelData(channel).slice().reverse(), channel);
    }
    reversedCopies.set(buffer, copy);
  }
  return copy;
}

interface Voice {
  readonly source: AudioBufferSourceNode;
  readonly startTime: number;
  /** When the voice has been told to stop, or Infinity if it plays to its end. */
  stopTime: number;
}

/**
 * Stops a voice at `time` unless it already stops sooner. A later `stop()` replaces an earlier one, so
 * calling it blindly would let a voice cut short by its own `duration` ring on until the next trigger.
 */
function stopVoice(voice: Voice, time: number): void {
  if (time >= voice.stopTime) return;
  voice.stopTime = time;
  voice.source.stop(time);
}

/**
 * Plays a buffer. Every trigger starts a new one-shot voice, so there is nothing to stop or rewind
 * between hits, and voices clean up after themselves when they end.
 */
export const sampler = defineNode({
  type: 'sampler',
  category: 'source',
  description:
    'Plays a recorded sound each time it is triggered. Every trigger starts a new voice, so nothing needs stopping or rewinding between hits. Silent until it has a buffer.',
  options: {
    buffer: {
      type: 'string | AudioBuffer | BufferRef',
      description:
        'The sound to play. A string is looked up in engine.buffers by name; if nothing has that name it is loaded as a URL.',
    },
    choke: {
      type: 'boolean',
      default: 'true',
      description:
        'A new trigger cuts off voices that are still sounding. Turn off to let hits overlap.',
    },
    voices: {
      type: 'number',
      default: '16',
      description:
        'Most voices sounding at once when choke is off. The oldest is cut to make room.',
    },
  },
  triggerOptions: {
    slice: {
      type: 'number',
      description:
        "Plays one slice of the buffer by index, using the buffer's slice boundaries. Wraps past the last slice.",
    },
    duration: { type: 'seconds', description: 'Stops the voice after this long.' },
    velocity: { type: 'number', default: '1', description: 'Level of this voice.' },
  },
  params: {
    speed: {
      default: 1,
      min: 0.0625,
      max: 8,
      unit: 'ratio',
      curve: 'log',
      rate: 'control',
      description:
        'Playback rate. 2 is twice as fast and an octave up; 0.5 is half speed, an octave down.',
    },
    start: {
      default: 0,
      min: 0,
      max: 60,
      unit: 'seconds',
      rate: 'control',
      description: 'Where in the buffer playback begins.',
    },
    end: {
      default: 0,
      min: 0,
      max: 60,
      unit: 'seconds',
      rate: 'control',
      description: 'Where playback stops. At or before start means the end of the buffer.',
    },
    loop: { default: false, description: 'Repeats the region until released.' },
    reverse: { default: false, description: 'Plays the region backwards.' },
    gain: { default: 1, min: 0, max: 2, unit: 'gain', description: 'Output level.' },
  },
  triggerable: true,
  build(context, init) {
    const out = new GainNode(context.audio);
    const voices = new Set<Voice>();
    const choke = init['choke'] !== false;
    const maxVoices =
      typeof init['voices'] === 'number' && init['voices'] >= 1 ? init['voices'] : 16;
    const ref: BufferRef | null =
      init['buffer'] === undefined ? null : context.buffer(init['buffer'] as BufferSource);

    const stopVoicesBefore = (time: number) => {
      for (const voice of voices) if (voice.startTime <= time) stopVoice(voice, time);
    };

    return {
      output: out,
      params: {
        gain: out.gain,
        // Voices already sounding follow speed changes; the rest are read when a voice starts.
        speed(value, at) {
          for (const voice of voices) voice.source.playbackRate.setValueAtTime(value as number, at);
        },
        start() {},
        end() {},
        loop() {},
        reverse() {},
      },
      trigger(options, at) {
        const buffer = ref?.buffer;
        if (!ref || !buffer) return;
        const number = (name: string) =>
          typeof options[name] === 'number' ? options[name] : (context.value(name, at) as number);
        const flag = (name: string) =>
          typeof options[name] === 'boolean' ? options[name] : (context.value(name, at) as boolean);

        let start = number('start');
        let end = number('end');
        if (typeof options['slice'] === 'number') {
          const boundaries = ref.slices;
          const count = boundaries.length - 1;
          if (count >= 1) {
            const index = ((Math.floor(options['slice']) % count) + count) % count;
            start = boundaries[index]!;
            end = boundaries[index + 1]!;
          }
        }
        const total = buffer.duration;
        start = Math.min(Math.max(start, 0), total);
        if (!(end > start)) end = total;
        end = Math.min(end, total);
        const length = end - start;
        if (length <= 0) return;

        const reverse = flag('reverse');
        const loop = flag('loop');
        const from = reverse ? total - end : start;

        if (choke) {
          stopVoicesBefore(at);
        } else if (voices.size >= maxVoices) {
          const oldest = [...voices].sort((a, b) => a.startTime - b.startTime)[0];
          if (oldest) stopVoice(oldest, at);
        }

        const source = new AudioBufferSourceNode(context.audio, {
          buffer: reverse ? reversed(buffer) : buffer,
          playbackRate: number('speed'),
        });
        const velocity = typeof options['velocity'] === 'number' ? options['velocity'] : 1;
        const level = velocity === 1 ? null : new GainNode(context.audio, { gain: velocity });
        if (level) {
          source.connect(level);
          level.connect(out);
        } else {
          source.connect(out);
        }

        if (loop) {
          source.loop = true;
          source.loopStart = from;
          source.loopEnd = from + length;
          source.start(at, from);
        } else {
          source.start(at, from, length);
        }
        const voice: Voice = { source, startTime: at, stopTime: Infinity };
        if (typeof options['duration'] === 'number') stopVoice(voice, at + options['duration']);
        voices.add(voice);
        source.onended = () => {
          voices.delete(voice);
          source.disconnect();
          level?.disconnect();
        };
      },
      release(_options, at) {
        stopVoicesBefore(at);
      },
      dispose() {
        for (const voice of voices) {
          voice.source.onended = null;
          voice.source.stop();
          voice.source.disconnect();
        }
        voices.clear();
      },
    };
  },
});
