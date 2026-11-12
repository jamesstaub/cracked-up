import type { Chain, MacroDefinition, MacroParam } from '../api';
import { defineMacro } from '../define';
import { dbToGain } from '../util/music';

/**
 * A lowpass or highpass filter's `q` is in decibels. -3.01 dB is a Butterworth response (a linear Q
 * of 0.7071), and two of those in a row make one Linkwitz-Riley slope: 24 dB per octave, and a low
 * and a high half that add back up to the level they were split from.
 */
const BUTTERWORTH_DB = 20 * Math.log10(Math.SQRT1_2);
/** An allpass filter's `q` is a plain number. At 0.7071 its phase is that of a Linkwitz-Riley pair. */
const ALLPASS_Q = Math.SQRT1_2;
/** How gradually each band's compression sets in above its threshold, in dB. */
const KNEE = 6;

type Band = 'low' | 'mid' | 'high';

const BAND_IS: Record<Band, string> = {
  low: 'the low band (bass and kick drum)',
  mid: 'the middle band (most of a voice, a snare or a guitar)',
  high: 'the high band (cymbals, hiss and the edge of a sound)',
};

const DEFAULTS: Record<Band, { threshold: number; ratio: number }> = {
  low: { threshold: -18, ratio: 4 },
  mid: { threshold: -15, ratio: 3 },
  high: { threshold: -15, ratio: 3 },
};

/** Each band's level after its compressor, by default: about what the default settings take off drums. */
const MAKEUP_DB = 3;

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function bandParams(band: Band): Record<string, MacroParam> {
  const select = `#${band}`;
  return {
    [`${band}Threshold`]: {
      default: DEFAULTS[band].threshold,
      min: -60,
      max: 0,
      unit: 'db',
      rate: 'control',
      description: `Level above which ${BAND_IS[band]} is turned down. Lower squashes more of it; 0 leaves the band alone.`,
      drives: [{ select, param: 'threshold' }],
    },
    [`${band}Ratio`]: {
      default: DEFAULTS[band].ratio,
      min: 1,
      max: 20,
      unit: 'ratio',
      rate: 'control',
      description: `How strongly ${BAND_IS[band]} is turned down once it is over its threshold. 1 does nothing, 4 is firm, 20 is a hard limit.`,
      drives: [{ select, param: 'ratio' }],
    },
    [`${band}Gain`]: {
      default: MAKEUP_DB,
      min: -24,
      max: 24,
      unit: 'db',
      description: `Level of ${BAND_IS[band]} after its compressor, in decibels. Use it to bring a squashed band back up, or to rebalance the tone. 0 adds nothing.`,
      drives: [{ select: `${select}Level`, param: 'gain', scale: dbToGain }],
    },
  };
}

/** Two Butterworth filters in a row: one Linkwitz-Riley slope. `side` is the crossover it belongs to. */
function slope(chain: Chain, type: 'lowpass' | 'highpass', side: string, frequency: number): Chain {
  const init = { class: side, frequency, q: BUTTERWORTH_DB };
  return chain[type](init)[type](init);
}

export const multiband: MacroDefinition<'multiband'> = defineMacro({
  type: 'multiband',
  category: 'dynamics',
  description:
    'A three-band compressor: the sound is split into lows, mids and highs, each is evened out by its own compressor, and the three are added back together. A loud kick then no longer pulls the cymbals down with it, as it would through a single compressor. Each band only turns down what is above its threshold; what is below keeps its level, and each band has a gain to bring it back up afterwards. With every threshold at 0 and every gain at 0 the sound passes through unchanged. Good on drums or a whole mix. It makes the sound about 6 milliseconds late.',
  params: {
    lowCrossover: {
      default: 200,
      min: 40,
      max: 1000,
      unit: 'hz',
      curve: 'log',
      description: 'Where the low band ends and the middle band begins.',
      drives: [{ select: '.lowCrossover', param: 'frequency' }],
    },
    highCrossover: {
      default: 2500,
      min: 1000,
      max: 12000,
      unit: 'hz',
      curve: 'log',
      description: 'Where the middle band ends and the high band begins.',
      drives: [{ select: '.highCrossover', param: 'frequency' }],
    },
    ...bandParams('low'),
    ...bandParams('mid'),
    ...bandParams('high'),
    attack: {
      default: 0.01,
      min: 0,
      max: 1,
      unit: 'seconds',
      curve: 'exp',
      description:
        'How quickly every band reacts to a loud sound. Longer lets the snap at the start of a drum hit through before the level comes down.',
      drives: [{ select: '.band', param: 'attack' }],
    },
    release: {
      default: 0.15,
      min: 0,
      max: 1,
      unit: 'seconds',
      curve: 'exp',
      description:
        'How quickly every band lets go once the sound is quiet again. Short pumps and breathes; long is smoother. Set with set({ release }).',
      drives: [{ select: '.band', param: 'release' }],
    },
    mix: {
      default: 1,
      min: 0,
      max: 1,
      unit: 'normalized',
      description:
        'Blend between the original and the compressed sound: 0 is only the original, 1 only the compressed. In between gives parallel compression, which keeps the punch of the original with the body of the squashed sound underneath. The original is lined up with the compressed sound first, so the blend does not thin the tone.',
      drives: [
        { select: '#wet', param: 'gain' },
        { select: '#dry', param: 'gain', scale: { multiply: -1, add: 1 } },
      ],
    },
  },
  build(__, _init, macro) {
    const value = (name: string) => num(macro.value(name), 0);
    const lowCrossover = value('lowCrossover');
    const highCrossover = value('highCrossover');
    const mix = value('mix');
    const input = __.bus('in').chain();

    // The compressed bands meet here.
    __().gain({ id: 'wet', gain: mix }).to('out');

    // One band's compressor and level control, on the end of its filters. The compressor's own
    // make-up gain is off: it would turn a band up by more the lower its threshold, so setting the
    // three thresholds differently would change the balance between the bands.
    const compress = (chain: Chain, band: Band): void => {
      chain
        .compressor({
          id: band,
          class: 'band',
          makeup: false,
          threshold: value(`${band}Threshold`),
          ratio: value(`${band}Ratio`),
          knee: KNEE,
          attack: value('attack'),
          release: value('release'),
        })
        .gain({ id: `${band}Level`, gain: dbToGain(value(`${band}Gain`)) })
        .connect('#wet');
    };

    // Each crossover turns the phase of what passes through it. The low band never meets the upper
    // crossover, so an allpass gives it the same turn; without it the three bands would not add back
    // up to a flat response.
    compress(
      slope(input, 'lowpass', 'lowCrossover', lowCrossover).allpass({
        class: 'highCrossover',
        frequency: highCrossover,
        q: ALLPASS_Q,
      }),
      'low',
    );
    const upper = slope(input, 'highpass', 'lowCrossover', lowCrossover);
    compress(slope(upper, 'lowpass', 'highCrossover', highCrossover), 'mid');
    compress(slope(upper, 'highpass', 'highCrossover', highCrossover), 'high');

    // The original, for `mix`. It is given the phase turn of both crossovers and the few milliseconds
    // a compressor takes (through one set to do nothing), so it adds to the bands without cancelling.
    input
      .allpass({ class: 'lowCrossover', frequency: lowCrossover, q: ALLPASS_Q })
      .allpass({ class: 'highCrossover', frequency: highCrossover, q: ALLPASS_Q })
      .compressor({ id: 'align', threshold: 0, ratio: 1, knee: 0 })
      .gain({ id: 'dry', gain: 1 - mix })
      .to('out');
  },
});
