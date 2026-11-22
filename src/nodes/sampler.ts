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
  /** Where it starts, and how much it plays unless it loops: seconds of the buffer it plays. */
  readonly from: number;
  readonly length: number;
  /** The part it repeats, in seconds of the buffer it plays, or null when it does not loop. */
  readonly loop: readonly [number, number] | null;
  /** It plays the reversed copy, so its place in the sound is counted from the end. */
  readonly reverse: boolean;
  /** Seconds the whole buffer lasts. */
  readonly total: number;
  /** Its speed over time: `rates[i]` from `times[i]` on. The first time is when it starts. */
  readonly times: number[];
  readonly rates: number[];
}

/**
 * Where a voice is in its sound at an audio time, in seconds from the start of the sound, or NaN
 * when it is not sounding then. Worked out from what the voice was told, not read from the audio.
 */
function positionOf(voice: Voice, time: number): number {
  if (time < voice.startTime || time >= voice.stopTime) return Number.NaN;
  let played = 0;
  for (let i = 0; i < voice.times.length; i++) {
    const until = i + 1 < voice.times.length ? Math.min(time, voice.times[i + 1]!) : time;
    if (until > voice.times[i]!) played += voice.rates[i]! * (until - voice.times[i]!);
  }
  let place = voice.from + played;
  if (voice.loop) {
    const [loopStart, loopEnd] = voice.loop;
    if (place >= loopEnd) place = loopStart + ((place - loopStart) % (loopEnd - loopStart));
  } else if (played >= voice.length) {
    return Number.NaN;
  }
  return voice.reverse ? voice.total - place : place;
}

/**
 * Notes a change of speed on a voice. The browser reads a source's playback rate once per block of
 * 128 frames, so a change takes effect at the first block that starts at or after its time.
 */
function noteRate(voice: Voice, rate: number, at: number, sampleRate: number): void {
  const block = 128 / sampleRate;
  const time = Math.ceil(at / block - 1e-9) * block;
  if (time <= voice.startTime) {
    voice.rates[0] = rate;
    return;
  }
  let index = voice.times.length;
  while (index > 1 && voice.times[index - 1]! > time) index--;
  if (voice.times[index - 1] === time) voice.rates[index - 1] = rate;
  else {
    voice.times.splice(index, 0, time);
    voice.rates.splice(index, 0, rate);
  }
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
        'The sound to play. A string is looked up in engine.buffers by name; if nothing has that name it is loaded as a URL. It can be changed later with setOption: voices already sounding finish on the sound they started with, and the next trigger plays the new one.',
      live: true,
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
      description:
        "Where in the buffer playback begins. The sound's own length is the real upper limit.",
    },
    end: {
      default: 0,
      min: 0,
      max: 60,
      unit: 'seconds',
      rate: 'control',
      description: 'Where playback stops. At or before start means the end of the buffer.',
    },
    loop: {
      default: false,
      description:
        'Repeats until released: the whole region, or the part of it between loopStart and loopEnd.',
    },
    loopStart: {
      default: 0,
      min: 0,
      max: 60,
      unit: 'seconds',
      rate: 'control',
      description:
        'With loop on, where in the buffer each repeat begins. Playback still begins at start. Kept inside the region.',
    },
    loopEnd: {
      default: 0,
      min: 0,
      max: 60,
      unit: 'seconds',
      rate: 'control',
      description:
        'With loop on, where in the buffer playback jumps back to loopStart. At or before loopStart means the whole region repeats.',
    },
    reverse: { default: false, description: 'Plays the region backwards.' },
    slice: {
      default: 0,
      min: 0,
      max: 128,
      step: 1,
      unit: 'none',
      rate: 'control',
      description:
        "Which slice a trigger plays, counting from 1, by the buffer's slice boundaries (wrapping past the last). 0 plays the region from start to end. Set it on each step to play a loop's slices in a new order. A trigger's own slice option (counting from 0) wins.",
    },
    gain: { default: 1, min: 0, max: 2, unit: 'gain', description: 'Output level.' },
  },
  triggerable: true,
  build(context, init) {
    const out = new GainNode(context.audio);
    const voices = new Set<Voice>();
    const choke = init['choke'] !== false;
    const maxVoices =
      typeof init['voices'] === 'number' && init['voices'] >= 1 ? init['voices'] : 16;
    const resolve = (source: unknown): BufferRef | null =>
      source === undefined || source === null ? null : context.buffer(source as BufferSource);
    // The buffer over time: `sounds[i]` from `since[i]` on. More than one only while a change of
    // buffer is scheduled ahead.
    const since: number[] = [Number.NEGATIVE_INFINITY];
    const sounds: (BufferRef | null)[] = [resolve(init['buffer'])];
    const soundAt = (time: number): BufferRef | null => {
      let index = since.length - 1;
      while (index > 0 && since[index]! > time) index--;
      return sounds[index]!;
    };

    const stopVoicesBefore = (time: number) => {
      for (const voice of voices) if (voice.startTime <= time) stopVoice(voice, time);
    };

    return {
      output: out,
      params: {
        gain: out.gain,
        // Voices already sounding follow speed changes; the rest are read when a voice starts.
        speed(value, at) {
          for (const voice of voices) {
            voice.source.playbackRate.setValueAtTime(value as number, at);
            noteRate(voice, value as number, at, context.audio.sampleRate);
          }
        },
        start() {},
        end() {},
        loop() {},
        loopStart() {},
        loopEnd() {},
        reverse() {},
      },
      options: {
        buffer(value, at) {
          const next = resolve(value);
          // Changes scheduled for later than this one are replaced by it; ones now in the past go.
          while (since.length > 1 && since[since.length - 1]! >= at) {
            since.pop();
            sounds.pop();
          }
          since.push(at);
          sounds.push(next);
          const now = context.audio.currentTime;
          while (since.length > 1 && since[1]! <= now) {
            since.shift();
            sounds.shift();
          }
        },
      },
      trigger(options, at) {
        const ref = soundAt(at);
        const buffer = ref?.buffer;
        if (!ref || !buffer) return;
        const number = (name: string) =>
          typeof options[name] === 'number' ? options[name] : (context.value(name, at) as number);
        const flag = (name: string) =>
          typeof options[name] === 'boolean' ? options[name] : (context.value(name, at) as boolean);

        let start = number('start');
        let end = number('end');
        // the trigger's own slice (from 0), else the slice parameter's (from 1; 0 is none)
        const own = options['slice'];
        const chosen = typeof own === 'number' ? Math.floor(own) : Math.round(number('slice')) - 1;
        if (typeof own === 'number' || chosen >= 0) {
          const boundaries = ref.slices;
          const count = boundaries.length - 1;
          if (count >= 1) {
            const index = ((chosen % count) + count) % count;
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
        // The part that repeats, in seconds of the buffer the voice plays: the loop points where
        // they fall inside the region, or all of it.
        let repeats: readonly [number, number] | null = loop ? [from, from + length] : null;
        if (loop) {
          const inside = (time: number) => Math.min(Math.max(time, start), end);
          const first = inside(number('loopStart'));
          const last = inside(number('loopEnd'));
          if (last > first) repeats = reverse ? [total - last, total - first] : [first, last];
        }

        if (choke) {
          stopVoicesBefore(at);
        } else if (voices.size >= maxVoices) {
          const oldest = [...voices].sort((a, b) => a.startTime - b.startTime)[0];
          if (oldest) stopVoice(oldest, at);
        }

        const speed = number('speed');
        const source = new AudioBufferSourceNode(context.audio, {
          buffer: reverse ? reversed(buffer) : buffer,
          playbackRate: speed,
        });
        const velocity = typeof options['velocity'] === 'number' ? options['velocity'] : 1;
        const level = velocity === 1 ? null : new GainNode(context.audio, { gain: velocity });
        if (level) {
          source.connect(level);
          level.connect(out);
        } else {
          source.connect(out);
        }

        if (repeats) {
          source.loop = true;
          source.loopStart = repeats[0];
          source.loopEnd = repeats[1];
          source.start(at, from);
        } else {
          source.start(at, from, length);
        }
        const voice: Voice = {
          source,
          startTime: at,
          stopTime: Infinity,
          from,
          length,
          loop: repeats,
          reverse,
          total,
          times: [at],
          rates: [speed],
        };
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
      silence(at) {
        // every voice, those due to start later too (a voice stopped before it starts is never heard)
        for (const voice of voices) stopVoice(voice, at);
      },
      buffer: () => sounds[sounds.length - 1] ?? null,
      playheads(at, into) {
        for (const voice of voices) {
          const position = positionOf(voice, at);
          if (!Number.isNaN(position)) into.push(position);
        }
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
