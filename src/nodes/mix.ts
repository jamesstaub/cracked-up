import type { ParamHandler, ParamMetaInput } from '../api';

/** The `mix` parameter every effect with a dry/wet blend shares. */
export const mixParam = (value: number): ParamMetaInput => ({
  default: value,
  min: 0,
  max: 1,
  unit: 'normalized',
  rate: 'control',
  description:
    'Blend between the original and the effect: 0 is only the original sound, 1 is only the effect, 0.5 is half of each.',
});

export interface Mix {
  /** Route the unprocessed signal through this. */
  readonly dry: GainNode;
  /** Route the processed signal through this. */
  readonly wet: GainNode;
  /** The handler to return as the node's `mix` parameter. */
  readonly handler: ParamHandler;
}

/**
 * Two gains that crossfade between the unprocessed and the processed signal: dry is `1 - mix` and wet
 * is `mix`. Both change at the same scheduled time, so the sum of the two gains is always 1.
 */
export function createMix(audio: BaseAudioContext): Mix {
  const dry = new GainNode(audio, { gain: 1 });
  const wet = new GainNode(audio, { gain: 0 });
  return {
    dry,
    wet,
    handler(value, at) {
      const mix = Math.min(1, Math.max(0, typeof value === 'number' ? value : 0));
      dry.gain.setValueAtTime(1 - mix, at);
      wet.gain.setValueAtTime(mix, at);
    },
  };
}
