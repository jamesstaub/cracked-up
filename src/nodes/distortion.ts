import { defineNode } from '../define';
import { createMix, mixParam } from './mix';

/**
 * A waveshaper whose curve can change at a scheduled time. A WaveShaperNode's curve cannot be
 * scheduled, so there are two shapers side by side with a gain on each: a change writes the new curve
 * to the silent one and swaps the gains at the exact time.
 *
 * Limit: a change scheduled after another change that has not happened yet rewrites the shaper that is
 * still audible until then. Changes made in time order, as a sequence makes them, are exact.
 */
function scheduledShaper(
  audio: BaseAudioContext,
  makeCurve: (value: number) => Float32Array<ArrayBuffer>,
  oversample: OverSampleType,
) {
  const input = new GainNode(audio);
  const output = new GainNode(audio);
  const shapers = [0, 1].map(() => new WaveShaperNode(audio, { oversample }));
  const gains = [new GainNode(audio, { gain: 1 }), new GainNode(audio, { gain: 0 })];
  shapers.forEach((shaper, i) => {
    input.connect(shaper).connect(gains[i]!).connect(output);
  });
  let active = 0;
  let first = true;
  return {
    input,
    output,
    set(value: number, at: number) {
      const curve = makeCurve(value);
      if (first) {
        // Nothing is audible yet, so both can take the starting curve at once.
        first = false;
        for (const shaper of shapers) shaper.curve = curve;
        return;
      }
      const next = 1 - active;
      shapers[next]!.curve = curve;
      gains[active]!.gain.setValueAtTime(0, at);
      gains[next]!.gain.setValueAtTime(1, at);
      active = next;
    },
    nodes: [input, output, ...shapers, ...gains] as AudioNode[],
  };
}

const DEG = Math.PI / 180;
const OVERSAMPLE: readonly OverSampleType[] = ['none', '2x', '4x'];

/** The soft-clipping curve both distortions use; `k` is how hard it bends. */
function curveFor(k: number, samples: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * DEG) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

export const overdrive = defineNode({
  type: 'overdrive',
  category: 'distortion',
  description:
    'Soft distortion, like a pushed guitar amp: loud parts are squashed and gain overtones, which makes the sound thicker and warmer. The sound is filtered before and after the distortion to shape its character.',
  params: {
    drive: {
      default: 0.5,
      min: 0,
      max: 1,
      unit: 'normalized',
      rate: 'control',
      description: 'How hard the signal is pushed into distortion. 0 is nearly clean; 1 is heavy.',
    },
    color: {
      default: 800,
      min: 20,
      max: 20000,
      unit: 'hz',
      curve: 'log',
      description:
        'Centre of a bandpass filter applied before the distortion. Only the sound near this frequency is distorted hard, so it sets which part of the sound the grit comes from.',
    },
    postCut: {
      default: 3000,
      min: 20,
      max: 20000,
      unit: 'hz',
      curve: 'log',
      description:
        'A lowpass filter after the distortion that removes the harsh highest overtones. Lower is darker and smoother.',
    },
  },
  shorthand: 'drive',
  build(context) {
    const audio = context.audio;
    const input = new GainNode(audio);
    const color = new BiquadFilterNode(audio, { type: 'bandpass' });
    const shaper = scheduledShaper(audio, (drive) => curveFor(drive * 100, 22050), 'none');
    const postCut = new BiquadFilterNode(audio, { type: 'lowpass' });
    const output = new GainNode(audio);
    input.connect(color).connect(shaper.input);
    shaper.output.connect(postCut).connect(output);
    return {
      input,
      output,
      params: {
        drive(value, at) {
          shaper.set(value as number, at);
        },
        color: color.frequency,
        postCut: postCut.frequency,
      },
      dispose() {
        for (const node of [input, color, postCut, output, ...shaper.nodes]) node.disconnect();
      },
    };
  },
});

export const waveshaper = defineNode({
  type: 'waveshaper',
  category: 'distortion',
  description:
    'Harder distortion: the signal is bent through a curve that flattens its peaks and adds many overtones, from gentle warmth to harsh fuzz.',
  params: {
    drive: {
      default: 50,
      min: 0,
      max: 100,
      unit: 'none',
      rate: 'control',
      description: 'How sharply the curve bends. 0 is gentle; 100 is a hard, buzzy clip.',
    },
  },
  shorthand: 'drive',
  options: {
    oversample: {
      type: "'none' | '2x' | '4x'",
      default: "'4x'",
      description:
        "How finely the distortion is worked out. '4x' keeps harsh false tones out of the top end but makes the sound late, by 4 milliseconds in Chrome and Safari; 'none' is rougher and adds no lateness, which matters inside a feedback loop.",
    },
  },
  build(context, init) {
    const oversample = OVERSAMPLE.find((choice) => choice === init['oversample']) ?? '4x';
    const shaper = scheduledShaper(context.audio, (drive) => curveFor(drive, 44100), oversample);
    return {
      input: shaper.input,
      output: shaper.output,
      params: {
        drive(value, at) {
          shaper.set(value as number, at);
        },
      },
      dispose() {
        for (const node of shaper.nodes) node.disconnect();
      },
    };
  },
});

export const ring = defineNode({
  type: 'ring',
  category: 'distortion',
  description:
    'Ring modulator: multiplies the sound by a sine wave. Every frequency in the input is replaced by two new ones (the input plus and minus the wave), which gives metallic, bell-like tones that are not musical harmonics of the original.',
  params: {
    frequency: {
      default: 30,
      min: 0.1,
      max: 5000,
      unit: 'hz',
      curve: 'log',
      description:
        'Frequency of the sine wave. Low values make the sound tremble; high values make it clangorous and strange.',
    },
    mix: mixParam(1),
  },
  shorthand: 'frequency',
  build(context) {
    const audio = context.audio;
    const input = new GainNode(audio);
    const output = new GainNode(audio);
    // The gain is 0 on its own; the oscillator drives it, so output = input x sine.
    const multiplier = new GainNode(audio, { gain: 0 });
    const osc = new OscillatorNode(audio, { type: 'sine' });
    const mix = createMix(audio);
    osc.connect(multiplier.gain);
    osc.start();
    input.connect(mix.dry).connect(output);
    input.connect(multiplier).connect(mix.wet).connect(output);
    return {
      input,
      output,
      params: { frequency: osc.frequency, mix: mix.handler },
      dispose() {
        osc.stop();
        for (const node of [osc, input, output, multiplier, mix.dry, mix.wet]) node.disconnect();
      },
    };
  },
});
