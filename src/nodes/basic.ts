import { defineNode } from '../define';

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

export const compressor = defineNode({
  type: 'compressor',
  category: 'dynamics',
  description: 'Turns loud passages down, evening out the level.',
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
