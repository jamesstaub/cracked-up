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
import { comb, delay } from './delays';
import { overdrive, ring, waveshaper } from './distortion';
import { adsr } from './envelopes';
import { lfo, stepper } from './modulators';
import { noise } from './noise';
import { saw, sine, square, triangle } from './oscillators';
import { reverb } from './reverb';
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
  noise,
  adsr,
  lfo,
  stepper,
  delay,
  comb,
  reverb,
  overdrive,
  waveshaper,
  ring,
];
