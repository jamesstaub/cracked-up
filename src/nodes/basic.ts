import type { ParamHandler } from '../api';
import { defineNode } from '../define';
import { dbToGain, gainToDb } from '../util/music';

export const gain = defineNode({
  type: 'gain',
  category: 'utility',
  description:
    'Multiplies the signal by a factor: 1 leaves it unchanged, 0.5 halves it, 0 silences it. Also used to set how strongly one signal modulates a parameter.',
  params: {
    gain: {
      default: 1,
      min: 0,
      max: 2,
      unit: 'gain',
      description: 'The factor. May go beyond the control range, including negative values.',
    },
  },
  shorthand: 'gain',
  build(context) {
    const node = new GainNode(context.audio);
    return { input: node, output: node, params: { gain: node.gain } };
  },
});

export const panner = defineNode({
  type: 'panner',
  category: 'utility',
  description: 'Places the signal between the left and right speakers.',
  params: {
    pan: {
      default: 0,
      min: -1,
      max: 1,
      unit: 'pan',
      description: '-1 is left, 0 centre, 1 right.',
    },
  },
  shorthand: 'pan',
  build(context) {
    const node = new StereoPannerNode(context.audio);
    return { input: node, output: node, params: { pan: node.pan } };
  },
});

/**
 * The gain a DynamicsCompressorNode adds by itself after compressing. Browsers work out how far a
 * full-scale sound would be turned down at the current settings and give back six tenths of that (in
 * decibels) to everything, so lowering the threshold also makes quiet sound louder. This repeats the
 * browsers' sum (all three share it), so that the gain can be taken out again; measured against the
 * real node it agrees to within 0.01 dB.
 */
export function compressorMakeup(threshold: number, knee: number, ratio: number): number {
  const linearThreshold = dbToGain(threshold);
  /** Output level for an input level inside the knee, both linear. `k` sets how sharply it bends. */
  const kneeCurve = (x: number, k: number): number =>
    x < linearThreshold ? x : linearThreshold + (1 - Math.exp(-k * (x - linearThreshold))) / k;
  const slopeAt = (x: number, k: number): number => {
    if (x < linearThreshold) return 1;
    const x2 = x * 1.001;
    const rise = gainToDb(kneeCurve(x2, k)) - gainToDb(kneeCurve(x, k));
    return rise / (gainToDb(x2) - gainToDb(x));
  };
  // The bend is chosen so that the curve leaves the knee at the slope the ratio asks for.
  const slope = 1 / ratio;
  const kneeEndDb = threshold + knee;
  const kneeEnd = dbToGain(kneeEndDb);
  let low = 0.1;
  let high = 10000;
  let k = 5;
  for (let i = 0; i < 15; i++) {
    if (slopeAt(kneeEnd, k) < slope) high = k;
    else low = k;
    k = Math.sqrt(low * high);
  }
  const fullScale =
    1 < kneeEnd
      ? kneeCurve(1, k)
      : dbToGain(gainToDb(kneeCurve(kneeEnd, k)) + slope * (0 - kneeEndDb));
  return (1 / fullScale) ** 0.6;
}

export const compressor = defineNode({
  type: 'compressor',
  category: 'dynamics',
  description:
    'Turns loud passages down, evening out the level. It also turns everything up a little to make up for that, more so the lower the threshold and the higher the ratio, so quiet sounds come out louder than they went in.',
  params: {
    threshold: {
      default: -24,
      min: -100,
      max: 0,
      unit: 'db',
      description: 'Level above which the signal is turned down.',
    },
    knee: {
      default: 30,
      min: 0,
      max: 40,
      unit: 'db',
      description: 'How gradually compression sets in around the threshold.',
    },
    ratio: {
      default: 12,
      min: 1,
      max: 20,
      unit: 'ratio',
      description: 'How strongly levels above the threshold are reduced.',
    },
    attack: {
      default: 0.003,
      min: 0,
      max: 1,
      unit: 'seconds',
      curve: 'exp',
      description: 'How quickly it reacts to a loud signal.',
    },
    release: {
      default: 0.25,
      min: 0,
      max: 1,
      unit: 'seconds',
      curve: 'exp',
      description: 'How quickly it lets go afterwards. Set with set({ release }).',
    },
  },
  options: {
    makeup: {
      type: 'boolean',
      default: 'true',
      description:
        'Whether the compressor turns everything up to make up for what it takes away. With false, sound below the threshold comes out at the level it went in and only what is above is turned down. Threshold, knee and ratio then change at the time asked but cannot be ramped or modulated.',
    },
  },
  build(context, init) {
    const audio = context.audio;
    const node = new DynamicsCompressorNode(audio);
    // A compressor that has not been running lets sound in gradually: measured in Firefox, the first
    // 25 ms after a silence come out 10 to 14 dB down, because Firefox stops running the node while
    // its input is silent. That swallows the attack of every drum hit. A constant far too small to
    // hear or to move the compressor (600 dB below full scale) keeps it running.
    const awake = new ConstantSourceNode(audio, { offset: 1e-30 });
    awake.connect(node);
    awake.start();
    const dispose = (): void => {
      awake.stop();
      awake.disconnect();
    };

    if (init['makeup'] !== false) {
      return {
        input: node,
        output: node,
        params: {
          threshold: node.threshold,
          knee: node.knee,
          ratio: node.ratio,
          attack: node.attack,
          release: node.release,
        },
        dispose,
      };
    }

    // Without make-up: a gain after the compressor undoes what it adds. That gain depends on three
    // settings together, so each of them is set through a function that also resets the gain.
    const level = new GainNode(audio);
    node.connect(level);
    const settings = {
      threshold: node.threshold.value,
      knee: node.knee.value,
      ratio: node.ratio.value,
    };
    const setting =
      (name: keyof typeof settings): ParamHandler =>
      (value, at) => {
        settings[name] = value as number;
        node[name].setValueAtTime(settings[name], at);
        const makeup = compressorMakeup(settings.threshold, settings.knee, settings.ratio);
        level.gain.setValueAtTime(1 / makeup, at);
      };
    return {
      input: node,
      output: level,
      params: {
        threshold: setting('threshold'),
        knee: setting('knee'),
        ratio: setting('ratio'),
        attack: node.attack,
        release: node.release,
      },
      dispose() {
        dispose();
        node.disconnect();
      },
    };
  },
});
