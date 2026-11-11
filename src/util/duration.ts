import type { Duration } from '../api';

const FRACTION = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)([td])?$/;
const BARS = /^(\d+(?:\.\d+)?)\s+bars?$/;

/**
 * Converts a musical duration to beats (quarter notes).
 * A number is already beats. '1/16' is a fraction of a whole note (0.25 beats), suffix `t` is a
 * triplet (x 2/3), suffix `d` is dotted (x 1.5). '2 bars' uses the time signature (default 4/4).
 * Throws RangeError for anything unparseable or non-finite/negative.
 */
export function durationToBeats(
  duration: Duration,
  timeSignature: readonly [number, number] = [4, 4],
): number {
  let beats: number;
  if (typeof duration === 'number') {
    beats = duration;
  } else if (typeof duration === 'string') {
    const text = duration.trim();
    const fraction = FRACTION.exec(text);
    const bars = BARS.exec(text);
    if (fraction) {
      const numerator = Number(fraction[1]);
      const denominator = Number(fraction[2]);
      if (denominator === 0)
        throw new RangeError(`Invalid duration "${duration}": zero denominator`);
      const suffix = fraction[3];
      const factor = suffix === 't' ? 2 / 3 : suffix === 'd' ? 1.5 : 1;
      beats = (numerator / denominator) * 4 * factor;
    } else if (bars) {
      const [perBar, unit] = timeSignature;
      if (!(unit > 0) || !(perBar > 0)) {
        throw new RangeError(`Invalid time signature [${perBar}, ${unit}]`);
      }
      beats = Number(bars[1]) * ((perBar * 4) / unit);
    } else {
      throw new RangeError(`Invalid duration "${duration}"`);
    }
  } else {
    throw new RangeError(`Invalid duration ${String(duration)}`);
  }
  if (!Number.isFinite(beats) || beats < 0) {
    throw new RangeError(
      `Invalid duration "${String(duration)}": result ${beats} is not a finite, non-negative number of beats`,
    );
  }
  return beats;
}

/** Seconds that a number of beats lasts at `bpm` (beats per minute). */
export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

/** Beats that elapse in `seconds` at `bpm`. */
export function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds * bpm) / 60;
}
