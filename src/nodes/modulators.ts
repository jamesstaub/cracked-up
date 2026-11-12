import { defineNode } from '../define';

const SHAPES: Record<string, OscillatorType> = {
  sine: 'sine',
  saw: 'sawtooth',
  square: 'square',
  triangle: 'triangle',
};

const depthParam = {
  default: 1,
  min: 0,
  max: 1000,
  unit: 'none',
  description:
    "How far the target moves each side of its own value, in the target's own units: a depth of 0.5 on a gain swings it by 0.5, a depth of 200 on a frequency swings it by 200 Hz.",
} as const;

export const lfo = defineNode({
  type: 'lfo',
  category: 'modulator',
  description:
    "A slow wave for moving another node's parameter: chain it into a node, and it makes that node's frequency rise and fall (vibrato, wobble, a sweeping filter). Pass `modulates` to drive a different parameter. It makes no sound itself.",
  params: {
    frequency: {
      default: 2,
      min: 0.01,
      max: 50,
      unit: 'hz',
      curve: 'log',
      description: 'How many times per second the wave repeats.',
    },
    depth: depthParam,
  },
  options: {
    shape: {
      type: "'sine' | 'saw' | 'square' | 'triangle'",
      default: "'sine'",
      description:
        'The wave: sine is smooth, triangle is straight-edged and smooth, saw ramps up then jumps back, square jumps between high and low.',
    },
  },
  modulates: 'frequency',
  build(context, init) {
    const shape = typeof init['shape'] === 'string' ? SHAPES[init['shape']] : undefined;
    const osc = new OscillatorNode(context.audio, { type: shape ?? 'sine' });
    const depth = new GainNode(context.audio);
    osc.connect(depth);
    osc.start();
    return {
      output: depth,
      params: { frequency: osc.frequency, depth: depth.gain },
      dispose() {
        osc.stop();
        osc.disconnect();
        depth.disconnect();
      },
    };
  },
});

export const stepper = defineNode({
  type: 'stepper',
  category: 'modulator',
  description:
    'Like an lfo, but it jumps between random levels instead of gliding: a looping series of random values, each held for an equal share of the loop. Chain it into a node to make its frequency hop around. It makes no sound itself.',
  params: { depth: depthParam },
  options: {
    steps: {
      type: 'number',
      default: '8',
      description: 'How many random values there are in one loop.',
    },
    length: {
      type: 'seconds',
      default: '1',
      description: 'How long one whole loop lasts, in seconds.',
    },
  },
  modulates: 'frequency',
  build(context, init) {
    const audio = context.audio;
    const steps = Math.max(1, Math.floor(typeof init['steps'] === 'number' ? init['steps'] : 8));
    const seconds = typeof init['length'] === 'number' && init['length'] > 0 ? init['length'] : 1;
    const length = Math.max(steps, Math.round(audio.sampleRate * seconds));
    const values = Array.from({ length: steps }, () => context.random() * 2 - 1);
    const buffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: audio.sampleRate });
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) data[i] = values[Math.floor((i * steps) / length)]!;
    buffer.copyToChannel(data, 0);

    const source = new AudioBufferSourceNode(audio, { buffer, loop: true });
    const depth = new GainNode(audio);
    source.connect(depth);
    source.start();
    return {
      output: depth,
      params: { depth: depth.gain },
      dispose() {
        source.stop();
        source.disconnect();
        depth.disconnect();
      },
    };
  },
});
