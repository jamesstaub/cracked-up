import { describe, expect, it } from 'vitest';
import { beatsToSeconds, durationToBeats, secondsToBeats } from './duration';

describe('durationToBeats', () => {
  it('passes numbers through', () => expect(durationToBeats(1.5)).toBe(1.5));
  it('parses fractions of a whole note', () => {
    expect(durationToBeats('1/16')).toBe(0.25);
    expect(durationToBeats('3/16')).toBe(0.75);
    expect(durationToBeats('1/4')).toBe(1);
    expect(durationToBeats('1/1')).toBe(4);
  });
  it('handles triplets and dotted', () => {
    expect(durationToBeats('1/8t')).toBeCloseTo(1 / 3, 12);
    expect(durationToBeats('1/8d')).toBeCloseTo(0.75, 12);
  });
  it('handles bars with time signatures', () => {
    expect(durationToBeats('1 bar')).toBe(4);
    expect(durationToBeats('2 bars')).toBe(8);
    expect(durationToBeats('0.5 bars')).toBe(2);
    expect(durationToBeats('1 bar', [3, 4])).toBe(3);
    expect(durationToBeats('2 bars', [6, 8])).toBe(6);
  });
  it('tolerates surrounding whitespace', () => expect(durationToBeats('  1/8 ')).toBe(0.5));
  it('throws RangeError on bad input', () => {
    for (const bad of ['', 'abc', '1/0', '1/', '-1/4', '1/8x', '1 beat', -1, NaN, Infinity]) {
      expect(() => durationToBeats(bad as never)).toThrow(RangeError);
    }
  });
});

describe('seconds conversion', () => {
  it('converts at 120 bpm', () => {
    expect(beatsToSeconds(1, 120)).toBe(0.5);
    expect(secondsToBeats(0.5, 120)).toBe(1);
  });
  it('round-trips', () => {
    expect(secondsToBeats(beatsToSeconds(3.7, 97), 97)).toBeCloseTo(3.7, 12);
  });
});
