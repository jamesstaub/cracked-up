import type { NodeDefinition, ParamMetaInput } from '../api';
import { defineNode } from '../define';

const frequency = (hz: number, description: string): ParamMetaInput => ({
  default: hz,
  min: 20,
  max: 20000,
  unit: 'hz',
  curve: 'log',
  description,
});
const q = (description: string): ParamMetaInput => ({
  default: 1,
  min: 0.0001,
  max: 30,
  unit: 'q',
  description,
});
const gainDb: ParamMetaInput = {
  default: 0,
  min: -40,
  max: 40,
  unit: 'db',
  description: 'Boost (positive) or cut (negative), in decibels.',
};

interface FilterSpec {
  description: string;
  frequency: number;
  frequencyIs: string;
  /** What q does on this filter, or null if the filter ignores it. */
  q: string | null;
  gain: boolean;
}

function filter<K extends BiquadFilterType>(type: K, spec: FilterSpec): NodeDefinition<K> {
  return defineNode({
    type,
    category: 'filter',
    description: spec.description,
    params: {
      frequency: frequency(spec.frequency, spec.frequencyIs),
      ...(spec.q === null ? {} : { q: q(spec.q) }),
      ...(spec.gain ? { gain: gainDb } : {}),
    },
    shorthand: 'frequency',
    build(context) {
      const node = new BiquadFilterNode(context.audio, { type });
      return {
        input: node,
        output: node,
        params: {
          frequency: node.frequency,
          ...(spec.q === null ? {} : { q: node.Q }),
          ...(spec.gain ? { gain: node.gain } : {}),
        },
      };
    },
  });
}

// Defaults leave the signal as untouched as each filter allows, so adding one changes nothing until it is turned.
const resonance = 'Resonance: a peak at the cutoff. Higher is sharper.';
const width = 'Narrowness of the band. Higher is narrower.';

export const lowpass = filter('lowpass', {
  description: 'Lets through what is below the cutoff and removes what is above.',
  frequency: 20000,
  frequencyIs: 'The cutoff.',
  q: resonance,
  gain: false,
});
export const highpass = filter('highpass', {
  description: 'Lets through what is above the cutoff and removes what is below.',
  frequency: 20,
  frequencyIs: 'The cutoff.',
  q: resonance,
  gain: false,
});
export const bandpass = filter('bandpass', {
  description: 'Lets through a band around the frequency and removes the rest.',
  frequency: 1000,
  frequencyIs: 'The centre of the band.',
  q: width,
  gain: false,
});
export const notch = filter('notch', {
  description: 'Removes a band around the frequency and lets through the rest.',
  frequency: 1000,
  frequencyIs: 'The centre of the removed band.',
  q: width,
  gain: false,
});
export const allpass = filter('allpass', {
  description:
    'Lets everything through but shifts phase around the frequency. Used to build phasers.',
  frequency: 1000,
  frequencyIs: 'Where the phase shift is centred.',
  q: 'How sharp the phase transition is.',
  gain: false,
});
export const lowshelf = filter('lowshelf', {
  description: 'Boosts or cuts everything below the frequency.',
  frequency: 200,
  frequencyIs: 'The top of the shelf.',
  q: null,
  gain: true,
});
export const highshelf = filter('highshelf', {
  description: 'Boosts or cuts everything above the frequency.',
  frequency: 4000,
  frequencyIs: 'The bottom of the shelf.',
  q: null,
  gain: true,
});
export const peaking = filter('peaking', {
  description: 'Boosts or cuts a band around the frequency and leaves the rest alone.',
  frequency: 1000,
  frequencyIs: 'The centre of the band.',
  q: width,
  gain: true,
});
