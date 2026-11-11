import { defineNode } from '../define';

/** Multiplies the signal by a factor. */
export const gain = defineNode({
  type: 'gain',
  category: 'utility',
  description: 'Changes the level of a signal.',
  params: {
    gain: { default: 1, min: 0, max: 2, unit: 'gain' },
  },
  shorthand: 'gain',
  build(context) {
    const node = new GainNode(context.audio);
    return { input: node, output: node, params: { gain: node.gain } };
  },
});

/** Places the signal between the left and right channels. */
export const panner = defineNode({
  type: 'panner',
  category: 'utility',
  description: 'Stereo position, from -1 (left) to 1 (right).',
  params: {
    pan: { default: 0, min: -1, max: 1, unit: 'pan' },
  },
  shorthand: 'pan',
  build(context) {
    const node = new StereoPannerNode(context.audio);
    return { input: node, output: node, params: { pan: node.pan } };
  },
});

/** Reduces the level of loud passages. */
export const compressor = defineNode({
  type: 'compressor',
  category: 'dynamics',
  description: 'Dynamics compressor.',
  params: {
    threshold: { default: -24, min: -100, max: 0, unit: 'db' },
    knee: { default: 30, min: 0, max: 40, unit: 'db' },
    ratio: { default: 12, min: 1, max: 20, unit: 'ratio' },
    attack: { default: 0.003, min: 0, max: 1, unit: 'seconds', curve: 'exp' },
    release: { default: 0.25, min: 0, max: 1, unit: 'seconds', curve: 'exp' },
  },
  build(context) {
    const node = new DynamicsCompressorNode(context.audio);
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
    };
  },
});
