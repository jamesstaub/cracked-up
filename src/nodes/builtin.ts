import type { MacroDefinition, NodeDefinition } from '../api';
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
import { bitcrusher } from './bitcrusher';
import { comb, delay } from './delays';
import { overdrive, ring, waveshaper } from './distortion';
import { adsr } from './envelopes';
import { lfo, stepper } from './modulators';
import { noise } from './noise';
import { saw, sine, square, triangle } from './oscillators';
import { input, looper, recorder } from './recording';
import { reverb } from './reverb';
import { sampler } from './sampler';
import { monosynth, polysynth } from './synths';

/** The node types every engine starts with. */
export const builtinNodes: readonly (NodeDefinition | MacroDefinition)[] = [
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
  bitcrusher,
  recorder,
  looper,
  input,
  monosynth,
  polysynth,
];
