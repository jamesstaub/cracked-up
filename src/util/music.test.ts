import { describe, expect, it } from 'vitest';
import {
  CHORD_NAMES,
  SCALE_NAMES,
  chords,
  dbToGain,
  freqToPitch,
  gainToDb,
  msToSec,
  pitchToFreq,
  scale,
  scales,
  secToMs,
} from './music';

describe('pitch and frequency', () => {
  it('anchors', () => {
    expect(pitchToFreq(69)).toBe(440);
    expect(pitchToFreq(81)).toBeCloseTo(880, 9);
    expect(pitchToFreq(60)).toBeCloseTo(261.6256, 3);
    expect(freqToPitch(440)).toBe(69);
  });
  it('does not floor', () => {
    expect(pitchToFreq(69.5)).toBeGreaterThan(440);
    expect(freqToPitch(450)).not.toBe(Math.floor(freqToPitch(450)));
  });
  it('round-trips', () => {
    for (let p = 0; p <= 127; p += 0.37) expect(freqToPitch(pitchToFreq(p))).toBeCloseTo(p, 9);
  });
});

describe('scale', () => {
  it('is linear by default and returns a number', () => {
    expect(scale(5, 0, 10, 0, 100)).toBe(50);
    expect(typeof scale(1, 0, 3, 0, 1)).toBe('number');
    expect(scale(1, 0, 3, 0, 1)).toBeCloseTo(1 / 3, 12);
  });
  it('log interpolates exponentially', () => {
    expect(scale(0, 0, 1, 20, 20000, 'log')).toBeCloseTo(20, 9);
    expect(scale(1, 0, 1, 20, 20000, 'log')).toBeCloseTo(20000, 6);
    expect(scale(0.5, 0, 1, 20, 20000, 'log')).toBeCloseTo(632.4555, 3);
  });
  it('log keeps the original `|| 1` for zero bounds', () => {
    expect(scale(0, 0, 1, 0, 100, 'log')).toBeCloseTo(1, 12);
  });
});

describe('gain and time', () => {
  it('db', () => {
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(0.5)).toBeCloseTo(-6.0206, 4);
    expect(gainToDb(0)).toBe(-Infinity);
    expect(dbToGain(gainToDb(0.37))).toBeCloseTo(0.37, 12);
    expect(dbToGain(-Infinity)).toBe(0);
  });
  it('ms', () => {
    expect(msToSec(1500)).toBe(1.5);
    expect(secToMs(1.5)).toBe(1500);
  });
});

describe('scales and chords', () => {
  it('match the original tables', () => {
    expect(scales('major')).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scales('wholetone')).toEqual([0, 2, 4, 6, 8, 10]);
    expect(chords('minor')).toEqual([0, 3, 7]);
    expect(chords('thirteenth')).toEqual([0, 4, 7, 10, 14, 17, 21]);
    expect(SCALE_NAMES).toHaveLength(7);
    expect(CHORD_NAMES).toHaveLength(10);
  });
  it('returns fresh arrays', () => {
    const a = scales('major');
    a[0] = 99;
    expect(scales('major')[0]).toBe(0);
  });
  it('every listed name resolves', () => {
    for (const n of SCALE_NAMES) expect(scales(n).length).toBeGreaterThan(0);
    for (const n of CHORD_NAMES) expect(chords(n).length).toBeGreaterThan(0);
  });
  it('throws on unknown names, including prototype keys', () => {
    expect(() => scales('nope' as never)).toThrow(RangeError);
    expect(() => scales('toString' as never)).toThrow(RangeError);
    expect(() => chords('nope' as never)).toThrow(RangeError);
  });
});
