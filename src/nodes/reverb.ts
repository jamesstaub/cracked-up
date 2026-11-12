import type { BufferSource } from '../api';
import { defineNode } from '../define';
import { createMix, mixParam } from './mix';

/**
 * A stereo tail of random noise that fades out: the sound a room would make in answer to a click.
 * Sample i is noise scaled by (1 - i/length) ** decay.
 */
function generateImpulse(
  audio: BaseAudioContext,
  random: () => number,
  seconds: number,
  decay: number,
  reverse: boolean,
): AudioBuffer {
  const length = Math.max(1, Math.round(audio.sampleRate * seconds));
  const impulse = new AudioBuffer({
    length,
    numberOfChannels: 2,
    sampleRate: audio.sampleRate,
  });
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const n = reverse ? length - i : i;
      data[i] = (random() * 2 - 1) * (1 - n / length) ** decay;
    }
  }
  return impulse;
}

export const reverb = defineNode({
  type: 'reverb',
  category: 'delay',
  description:
    'A simulated room: the sound is smeared into a dense tail of reflections that fades away. Uses a generated tail of random noise, or a recording of a real space if you give one.',
  params: { mix: mixParam(0.3) },
  options: {
    seconds: {
      type: 'seconds',
      default: '3',
      description: 'Length of the generated tail. Nothing is heard after this long.',
    },
    decay: {
      type: 'number',
      default: '2',
      description:
        'How quickly the generated tail fades. Higher fades faster, so the room sounds smaller.',
    },
    reverse: {
      type: 'boolean',
      default: 'false',
      description: 'Plays the generated tail backwards: it swells up and then stops.',
    },
    impulse: {
      type: 'string | AudioBuffer | BufferRef',
      description:
        'A recording of a space (an impulse response) to use instead of the generated tail. A string is looked up in engine.buffers by name; if nothing has that name it is loaded as a URL.',
    },
  },
  build(context, init) {
    const audio = context.audio;
    const input = new GainNode(audio);
    const output = new GainNode(audio);
    const convolver = new ConvolverNode(audio); // normalize stays on, so the tail has a sensible level
    const mix = createMix(audio);
    let disposed = false;

    if (init['impulse'] === undefined) {
      const seconds = typeof init['seconds'] === 'number' ? init['seconds'] : 3;
      const decay = typeof init['decay'] === 'number' ? init['decay'] : 2;
      convolver.buffer = generateImpulse(
        audio,
        context.random,
        seconds,
        decay,
        init['reverse'] === true,
      );
    } else {
      const ref = context.buffer(init['impulse'] as BufferSource);
      const use = (buffer: AudioBuffer) => {
        if (disposed) return;
        try {
          convolver.buffer = buffer;
        } catch (error) {
          // A convolver only accepts a buffer at the context's own sample rate.
          console.error('cracked-up: reverb could not use its impulse', error);
        }
      };
      // A buffer that is already loaded is used at once; one still loading is used when it arrives.
      if (ref.buffer) use(ref.buffer);
      else ref.ready.then(use, () => {}); // the buffer store reports load failures
    }

    input.connect(mix.dry).connect(output);
    input.connect(convolver).connect(mix.wet).connect(output);

    return {
      input,
      output,
      params: { mix: mix.handler },
      dispose() {
        disposed = true;
        for (const node of [input, output, convolver, mix.dry, mix.wet]) node.disconnect();
      },
    };
  },
});
