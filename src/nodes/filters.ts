import type { NodeDefinition, ParamMetaInput } from '../api';
import { defineNode } from '../define';

const frequency = (hz: number): ParamMetaInput => ({
  default: hz,
  min: 20,
  max: 20000,
  unit: 'hz',
  curve: 'log',
});
const q: ParamMetaInput = { default: 1, min: 0.0001, max: 30, unit: 'q' };
const gainDb: ParamMetaInput = { default: 0, min: -40, max: 40, unit: 'db' };

function filter<K extends string>(
  type: K,
  nativeType: BiquadFilterType,
  description: string,
  defaultFrequency: number,
  uses: { q: boolean; gain: boolean },
): NodeDefinition<K> {
  return defineNode({
    type,
    category: 'filter',
    description,
    params: {
      frequency: frequency(defaultFrequency),
      ...(uses.q ? { q } : {}),
      ...(uses.gain ? { gain: gainDb } : {}),
    },
    shorthand: 'frequency',
    build(context) {
      const node = new BiquadFilterNode(context.audio, { type: nativeType });
      return {
        input: node,
        output: node,
        params: {
          frequency: node.frequency,
          ...(uses.q ? { q: node.Q } : {}),
          ...(uses.gain ? { gain: node.gain } : {}),
        },
      };
    },
  });
}

// Defaults leave the signal as untouched as each filter allows, so adding one changes nothing until it is turned.
export const lowpass = filter('lowpass', 'lowpass', 'Passes frequencies below the cutoff.', 20000, {
  q: true,
  gain: false,
});
export const highpass = filter('highpass', 'highpass', 'Passes frequencies above the cutoff.', 20, {
  q: true,
  gain: false,
});
export const bandpass = filter(
  'bandpass',
  'bandpass',
  'Passes a band around the frequency.',
  1000,
  {
    q: true,
    gain: false,
  },
);
export const notch = filter('notch', 'notch', 'Removes a band around the frequency.', 1000, {
  q: true,
  gain: false,
});
export const allpass = filter('allpass', 'allpass', 'Shifts phase around the frequency.', 1000, {
  q: true,
  gain: false,
});
export const lowshelf = filter('lowshelf', 'lowshelf', 'Boosts or cuts below the frequency.', 200, {
  q: false,
  gain: true,
});
export const highshelf = filter(
  'highshelf',
  'highshelf',
  'Boosts or cuts above the frequency.',
  4000,
  {
    q: false,
    gain: true,
  },
);
export const peaking = filter(
  'peaking',
  'peaking',
  'Boosts or cuts a band around the frequency.',
  1000,
  {
    q: true,
    gain: true,
  },
);
