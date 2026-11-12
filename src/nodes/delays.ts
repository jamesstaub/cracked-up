import type { NodeDefinition, ParamMetaInput } from '../api';
import { defineNode } from '../define';
import { createMix, mixParam } from './mix';

interface EchoSpec {
  description: string;
  time: { default: number; min: number; description: string };
  timeMax: number;
  feedback: { default: number; max: number };
  cutoff: number;
  mix: number;
}

function echo<K extends string>(type: K, spec: EchoSpec): NodeDefinition<K> {
  const params: Record<string, ParamMetaInput> = {
    time: {
      default: spec.time.default,
      min: spec.time.min,
      max: spec.timeMax,
      unit: 'seconds',
      curve: 'exp',
      description: spec.time.description,
    },
    feedback: {
      default: spec.feedback.default,
      min: 0,
      max: spec.feedback.max,
      unit: 'gain',
      description:
        'How much of each echo is fed back into the delay to make the next one. 0 gives a single echo; closer to the maximum, the echoes last longer.',
    },
    cutoff: {
      default: spec.cutoff,
      min: 20,
      max: 20000,
      unit: 'hz',
      curve: 'log',
      description:
        'A lowpass filter on the fed-back sound: each repeat loses the frequencies above this, so the echoes get duller. The top of the range leaves them bright.',
    },
    mix: mixParam(spec.mix),
  };
  return defineNode({
    type,
    category: 'delay',
    description: spec.description,
    params,
    shorthand: 'time',
    build(context) {
      const audio = context.audio;
      const input = new GainNode(audio);
      const output = new GainNode(audio);
      const delay = new DelayNode(audio, { maxDelayTime: 5, delayTime: spec.time.default });
      // A lowpass's Q is in decibels. The default of 1 dB gives a resonant peak that can push the loop's
      // gain above 1 near the cutoff, and the echoes would grow instead of fading; -3.01 dB (a Butterworth
      // response) never amplifies, so feedback below 1 always dies away.
      const tone = new BiquadFilterNode(audio, { type: 'lowpass', Q: -3.0103 });
      const feedback = new GainNode(audio);
      const mix = createMix(audio);

      input.connect(mix.dry).connect(output);
      input.connect(delay);
      delay.connect(mix.wet).connect(output);
      delay.connect(tone).connect(feedback).connect(delay);

      return {
        input,
        output,
        params: {
          time: delay.delayTime,
          feedback: feedback.gain,
          cutoff: tone.frequency,
          mix: mix.handler,
        },
        dispose() {
          for (const node of [input, output, delay, tone, feedback, mix.dry, mix.wet]) {
            node.disconnect();
          }
        },
      };
    },
  });
}

export const delay = echo('delay', {
  description:
    'An echo: the sound repeats after a set time, and each repeat is quieter (and, with the cutoff turned down, duller) than the last.',
  time: { default: 0.25, min: 0.001, description: 'Time between echoes, in seconds.' },
  timeMax: 2,
  feedback: { default: 0.4, max: 0.95 },
  cutoff: 20000,
  mix: 0.5,
});

export const comb = echo('comb', {
  description:
    'A very short echo that repeats so fast it blurs into a pitched ring: the sound is coloured with a note whose pitch is 1 divided by the time. Good for metallic or plucked-string tones.',
  time: {
    default: 0.027,
    min: 0.0005,
    description:
      'Time between repeats, in seconds. The ring is at 1 divided by this many Hz. Browsers cannot loop a delay shorter than about 0.003 seconds, so shorter settings behave as 0.003.',
  },
  timeMax: 0.1,
  feedback: { default: 0.84, max: 0.98 },
  cutoff: 3000,
  mix: 1,
});
