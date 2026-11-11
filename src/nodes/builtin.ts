import type { NodeDefinition } from '../api';
import { compressor, gain, panner } from './basic';
import {
  allpass,
  bandpass,
  highpass,
  highshelf,
  lowpass,
  lowshelf,
  notch,
  peaking,
} from './filters';
import { saw, sine, square, triangle } from './oscillators';
import { sampler } from './sampler';

/** The node types every engine starts with. */
export const builtinNodes: readonly NodeDefinition[] = [
  gain,
  panner,
  compressor,
  lowpass,
  highpass,
  bandpass,
  notch,
  allpass,
  lowshelf,
  highshelf,
  peaking,
  sine,
  saw,
  square,
  triangle,
  sampler,
];
