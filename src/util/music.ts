/** MIDI note number to Hz. A4 = 69 = 440 Hz. Fractional pitches give fractional frequencies. */
export function pitchToFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

/** Hz to MIDI note number, fractional (not floored). */
export function freqToPitch(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

/**
 * Maps `value` from the input range to the output range.
 * - linear: ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin. Not rounded.
 * - log: exponential mapping, as in Cracked:
 *   exp(ln(outMin || 1) + ((ln(outMax || 1) - ln(outMin || 1)) / (inMax - inMin)) * (value - inMin)).
 *   An out bound of 0 is treated as 1 (the original's `|| 1`), so the output is never 0.
 */
export function scale(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
  curve: 'linear' | 'log' = 'linear',
): number {
  if (curve === 'log') {
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

export function msToSec(ms: number): number {
  return ms / 1000;
}

export function secToMs(seconds: number): number {
  return seconds * 1000;
}

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
