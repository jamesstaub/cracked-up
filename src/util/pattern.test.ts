import { describe, expect, it } from 'vitest';
import {
  arrayNext,
  array_next,
  euclid,
  everyNth,
  fillArray,
  fill_array,
  holdSteps,
  parsePattern,
  sequence_factory,
  throttle_factory,
} from './pattern';

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

describe('fillArray', () => {
  it('fills with zeros, or with what the function returns for each position', () => {
    expect(fillArray(3)).toEqual([0, 0, 0]);
    expect(fillArray(4, (i) => i * 2)).toEqual([0, 2, 4, 6]);
    expect(fillArray(2, () => 'x')).toEqual(['x', 'x']);
  });
  it('gives an empty list for sizes that make no sense', () => {
    expect(fillArray(0)).toEqual([]);
    expect(fillArray(-2)).toEqual([]);
    expect(fillArray(Number.NaN)).toEqual([]);
    expect(fillArray(2.9)).toEqual([0, 0]);
  });
  it('keeps the Cracked name', () => {
    expect(fill_array).toBe(fillArray);
  });
});

describe('arrayNext', () => {
  const take = <T>(n: number, next: () => T): T[] => Array.from({ length: n }, next);
  it('steps through a list and starts over', () => {
    const notes = [60, 62, 64];
    expect(take(7, () => arrayNext(notes))).toEqual([60, 62, 64, 60, 62, 64, 60]);
  });
  it('remembers its place per list', () => {
    const a = [1, 2, 3];
    const b = [1, 2, 3];
    arrayNext(a);
    arrayNext(a);
    expect(arrayNext(b)).toBe(1);
    expect(arrayNext(a)).toBe(3);
  });
  it('offset and limit narrow it to part of the list', () => {
    const six = [0, 1, 2, 3, 4, 5];
    expect(take(5, () => arrayNext(six, 2, 4))).toEqual([2, 3, 2, 3, 2]);
    const list = [0, 1, 2, 3];
    expect(take(5, () => arrayNext(list, 1))).toEqual([1, 2, 3, 1, 2]);
    // Out-of-range values are pulled into the list.
    const three = [7, 8, 9];
    expect(take(3, () => arrayNext(three, 10, 99))).toEqual([9, 9, 9]);
    const neg = [7, 8, 9];
    expect(take(4, () => arrayNext(neg, -3, 0))).toEqual([7, 8, 9, 7]);
  });
  it('calls onWrap each time it starts over, but not on the first call', () => {
    let wraps = 0;
    const list = ['a', 'b'];
    take(5, () => arrayNext(list, 0, 2, () => wraps++));
    expect(wraps).toBe(2);
    let single = 0;
    const one = ['a'];
    take(3, () => arrayNext(one, 0, 1, () => single++));
    expect(single).toBe(2);
  });
  it('gives undefined for an empty list', () => {
    expect(arrayNext([])).toBeUndefined();
  });
  it('keeps the Cracked name', () => {
    expect(array_next).toBe(arrayNext);
  });
});

describe('everyNth', () => {
  it('is true on every nth call', () => {
    const third = everyNth(3);
    expect(Array.from({ length: 7 }, () => third())).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
      false,
    ]);
    const always = everyNth(1);
    expect([always(), always()]).toEqual([true, true]);
  });
  it('counters are independent', () => {
    const a = everyNth(2);
    const b = everyNth(2);
    a();
    expect(b()).toBe(false);
    expect(a()).toBe(true);
  });
  it('throws on a count that makes no sense', () => {
    expect(() => everyNth(0)).toThrow(RangeError);
    expect(() => everyNth(1.5)).toThrow(RangeError);
  });
  it('keeps the Cracked name', () => {
    expect(throttle_factory).toBe(everyNth);
  });
});

describe('holdSteps', () => {
  it('holds each position for its count of calls', () => {
    const next = holdSteps([4, 2]);
    expect(Array.from({ length: 9 }, () => next())).toEqual([0, 0, 0, 0, 1, 1, 0, 0, 0]);
  });
  it('tells the function when the position changed, as Cracked did', () => {
    const seen: [boolean, number][] = [];
    const next = holdSteps([2, 1], (changed, index) => seen.push([changed, index]));
    for (let i = 0; i < 5; i++) next();
    expect(seen).toEqual([
      [true, 0],
      [false, 0],
      [true, 1],
      [true, 0],
      [false, 0],
    ]);
  });
  it('skips counts below 1 and keeps the original positions', () => {
    const next = holdSteps([0, 2, -1, 1]);
    expect(Array.from({ length: 4 }, () => next())).toEqual([1, 1, 3, 1]);
    expect(() => holdSteps([])).toThrow(RangeError);
    expect(() => holdSteps([0])).toThrow(RangeError);
  });
  it('does not see later changes to the list it was given', () => {
    const counts = [1, 1];
    const next = holdSteps(counts);
    counts[0] = 5;
    expect([next(), next(), next()]).toEqual([0, 1, 0]);
  });
  it('keeps the Cracked name', () => {
    expect(sequence_factory).toBe(holdSteps);
  });
});
