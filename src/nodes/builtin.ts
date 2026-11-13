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
  smooth,
} from './filters';
import { bitcrusher } from './bitcrusher';
import { comb, delay, delayline } from './delays';
import { overdrive, ring, waveshaper } from './distortion';
import { adsr } from './envelopes';
import { multiband } from './multiband';
import { lfo, stepper } from './modulators';
import { noise } from './noise';
import { saw, sine, square, triangle } from './oscillators';
import { input, looper, recorder } from './recording';
import { reverb } from './reverb';
import { sampler } from './sampler';
import { monosynth, polysynth } from './synths';
import { tapedelay } from './tapedelay';

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
  smooth,
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
  delayline,
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
  multiband,
  tapedelay,
];
