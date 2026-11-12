import { randomInt } from './random';
import type { RandomSource } from './random';

/** MIDI note number to Hz. A4 = 69 = 440 Hz. Fractional pitches give fractional frequencies. */
export function pitchToFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

/** Hz to MIDI note number, fractional (not floored). */
export function freqToPitch(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

/** The Cracked name for `pitchToFreq`. Unlike Cracked's, it does not round the pitch down first. */
export const pitch2freq = pitchToFreq;

/** The Cracked name for `freqToPitch`. Unlike Cracked's, it does not round the result down. */
export const freq2pitch = freqToPitch;

/** Keeps a number inside a range: below `min` gives `min`, above `max` gives `max`. */
export function clamp(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Maps `value` from the input range to the output range.
 * - linear: ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin. Not rounded.
 * - log: exponential mapping, as in Cracked:
 *   exp(ln(outMin || 1) + ((ln(outMax || 1) - ln(outMin || 1)) / (inMax - inMin)) * (value - inMin)).
 *   An out bound of 0 is treated as 1 (the original's `|| 1`), so the output is never 0.
 *   'logarithmic' is accepted as another spelling of 'log', as in Cracked.
 *
 * `scale(64, 0, 127, 0, 1)` turns a MIDI controller value into a level of about 0.5.
 */
export function scale(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
  curve: 'linear' | 'log' | 'logarithmic' = 'linear',
): number {
  if (curve === 'log' || curve === 'logarithmic') {
    const minVal = Math.log(outMin || 1);
    const maxVal = Math.log(outMax || 1);
    const factor = (maxVal - minVal) / (inMax - inMin);
    return Math.exp(minVal + factor * (value - inMin));
  }
  return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

/** Linear gain to decibels. 0 gives -Infinity. */
export function gainToDb(gain: number): number {
  return 20 * Math.log10(gain);
}

/** Decibels to linear gain. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Milliseconds to seconds: `msToSec(250)` is 0.25. */
export function msToSec(ms: number): number {
  return ms / 1000;
}

/** Seconds to milliseconds: `secToMs(0.25)` is 250. */
export function secToMs(seconds: number): number {
  return seconds * 1000;
}

/** Milliseconds to minutes: `msToMin(90000)` is 1.5. */
export function msToMin(ms: number): number {
  return ms / 60000;
}

/** Minutes to milliseconds: `minToMs(1.5)` is 90000. */
export function minToMs(minutes: number): number {
  return minutes * 60000;
}

/** The Cracked name for `msToSec`. */
export const ms2sec = msToSec;
/** The Cracked name for `secToMs`. */
export const sec2ms = secToMs;
/** The Cracked name for `msToMin`. */
export const ms2min = msToMin;
/** The Cracked name for `minToMs`. */
export const min2ms = minToMs;

const SCALE_TABLE = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  wholetone: [0, 2, 4, 6, 8, 10],
  overtone: [0, 2, 4, 6, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
} as const;

const CHORD_TABLE = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  seventh: [0, 4, 7, 10],
  ninth: [0, 4, 7, 10, 14],
  major_seventh: [0, 4, 7, 11],
  minor_seventh: [0, 3, 7, 10],
  suspended: [0, 5, 7],
  diminished: [0, 3, 6],
  eleventh: [0, 4, 7, 10, 14, 17],
  thirteenth: [0, 4, 7, 10, 14, 17, 21],
} as const;

export type ScaleName = keyof typeof SCALE_TABLE;
export type ChordName = keyof typeof CHORD_TABLE;

export const SCALE_NAMES = Object.keys(SCALE_TABLE) as readonly ScaleName[];
export const CHORD_NAMES = Object.keys(CHORD_TABLE) as readonly ChordName[];

/** Semitone offsets of a named scale. Returns a fresh array; unknown names throw RangeError. */
export function scales(name: ScaleName): number[] {
  if (!Object.hasOwn(SCALE_TABLE, name)) {
    throw new RangeError(`Unknown scale "${String(name)}". Known: ${SCALE_NAMES.join(', ')}`);
  }
  return [...SCALE_TABLE[name]];
}

/** Semitone offsets of a named chord. Returns a fresh array; unknown names throw RangeError. */
export function chords(name: ChordName): number[] {
  if (!Object.hasOwn(CHORD_TABLE, name)) {
    throw new RangeError(`Unknown chord "${String(name)}". Known: ${CHORD_NAMES.join(', ')}`);
  }
  return [...CHORD_TABLE[name]];
}

function randomNote(
  steps: readonly number[],
  octaveLow: number,
  octaveHigh: number,
  source: RandomSource | undefined,
): number {
  const step = steps[randomInt(0, steps.length - 1, source)] ?? 0;
  const octave = randomInt(octaveLow, octaveHigh, source);
  return pitchToFreq(step + octave * 12);
}

/**
 * A random note of a scale, as a frequency in Hz. The scale starts on C. The octave is chosen at
 * random from `octaveLow` to `octaveHigh` (default 3 to 7), where octave 5 starts on middle C
 * (MIDI note 60, since the note number is the scale step plus 12 times the octave).
 *
 * Call it once per note: `__('#synth').set({ frequency: randomScale('minor', 4, 5) })`.
 * Pass a seeded source last for the same notes every time.
 */
export function randomScale(
  name: ScaleName,
  octaveLow = 3,
  octaveHigh = 7,
  source?: RandomSource,
): number {
  return randomNote(scales(name), octaveLow, octaveHigh, source);
}

/**
 * A random note of a chord, as a frequency in Hz. Works like `randomScale`, with a chord name such
 * as 'minor_seventh' in place of the scale.
 */
export function randomArpeggio(
  name: ChordName,
  octaveLow = 3,
  octaveHigh = 7,
  source?: RandomSource,
): number {
  return randomNote(chords(name), octaveLow, octaveHigh, source);
}

/** The Cracked name for `randomScale`. */
export const random_scale = randomScale;
/** The Cracked name for `randomArpeggio`. */
export const random_arpeggio = randomArpeggio;
