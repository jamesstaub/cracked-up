import { describe, expect, it } from 'vitest';
import { euclid, parsePattern } from './pattern';

describe('parsePattern', () => {
  it('parses compact form', () => {
    expect(parsePattern('x..x|..x.')).toEqual([1, 0, 0, 1, 0, 0, 1, 0]);
    expect(parsePattern('X - _ x')).toEqual([1, 0, 0, 1]);
  });
  it('parses numbers', () => {
    expect(parsePattern('1 0 0 2')).toEqual([1, 0, 0, 2]);
    expect(parsePattern('1,0,0.5')).toEqual([1, 0, 0.5]);
    expect(parsePattern('1, 0 ,0.5')).toEqual([1, 0, 0.5]);
  });
  it('copies arrays', () => {
    const a = [1, 0, 1];
    const b = parsePattern(a);
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
  });
  it('throws on invalid', () => {
    for (const bad of ['', '   ', '|', [], [1, NaN], [Infinity], '1 a', 'x.q', '1 0 x']) {
      expect(() => parsePattern(bad as never)).toThrow(RangeError);
    }
  });
});

describe('euclid', () => {
  it('matches known patterns', () => {
    expect(euclid(3, 8)).toEqual([1, 0, 0, 1, 0, 0, 1, 0]);
    expect(euclid(5, 8)).toEqual([1, 0, 1, 1, 0, 1, 1, 0]);
    expect(euclid(2, 5)).toEqual([1, 0, 1, 0, 0]);
    const e = euclid(4, 16);
    expect(e.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([0, 4, 8, 12]);
  });
  it('agrees with the Euclip implementation at rotate 0', () => {
    const expected: Record<string, string> = {
      '3,8': '10010010',
      '7,16': '1001010100101010',
      '3,7': '1010100',
      '1,4': '1000',
      '8,8': '11111111',
    };
    for (const [key, bits] of Object.entries(expected)) {
      const [k, n] = key.split(',').map(Number);
      expect(euclid(k!, n!).join('')).toBe(bits);
    }
  });
  it('rotates left, wrapping, negative allowed', () => {
    expect(euclid(3, 8, 1)).toEqual([0, 0, 1, 0, 0, 1, 0, 1]);
    expect(euclid(3, 8, 8)).toEqual(euclid(3, 8));
    expect(euclid(3, 8, -1)).toEqual([0, 1, 0, 0, 1, 0, 0, 1]);
    expect(euclid(3, 8, 9)).toEqual(euclid(3, 8, 1));
  });
  it('clamps hits', () => {
    expect(euclid(0, 4)).toEqual([0, 0, 0, 0]);
    expect(euclid(-2, 4)).toEqual([0, 0, 0, 0]);
    expect(euclid(9, 4)).toEqual([1, 1, 1, 1]);
  });
  it('always has the right length and hit count', () => {
    for (let n = 1; n <= 16; n++)
      for (let k = 0; k <= n; k++) {
        const p = euclid(k, n);
        expect(p).toHaveLength(n);
        expect(p.reduce((a, b) => a + b, 0)).toBe(k);
      }
  });
  it('throws on bad steps', () => {
    expect(() => euclid(1, 0)).toThrow(RangeError);
    expect(() => euclid(1, 2.5)).toThrow(RangeError);
    expect(() => euclid(1, -3)).toThrow(RangeError);
    expect(() => euclid(1.5, 4)).toThrow(RangeError);
  });
});
