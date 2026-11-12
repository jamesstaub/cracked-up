import { defineNode } from '../define';
import { BITCRUSHER } from '../worklets/processors';

export const bitcrusher = defineNode({
  type: 'bitcrusher',
  category: 'distortion',
  description:
    'Makes the sound gritty and digital in two ways: fewer loudness levels (bits) and fewer samples per second (rate).',
  params: {
    bits: {
      default: 8,
      min: 1,
      max: 16,
      step: 1,
      rate: 'audio',
      description:
        'How many bits describe each sample. 16 is clean; below about 6 is harsh and noisy.',
    },
    rate: {
      default: 1,
      min: 0.0001,
      max: 1,
      curve: 'log',
      unit: 'ratio',
      rate: 'audio',
      description:
        'What fraction of the samples are kept. 1 keeps every one; 0.1 keeps one in ten, which sounds metallic.',
    },
  },
  build(context) {
    const node = context.worklet(BITCRUSHER, { numberOfInputs: 1, numberOfOutputs: 1 });
    return {
      input: node,
      output: node,
      params: {
        bits: node.parameters.get('bits')!,
        rate: node.parameters.get('rate')!,
      },
      dispose() {
        node.disconnect();
      },
    };
  },
});
