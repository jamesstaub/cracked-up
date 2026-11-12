import { describe, expect, it } from 'vitest';
import { euclid } from './pattern';
import { scales } from './music';
import {
  MAX_PATTERN_STEPS,
  and,
  binaryPattern,
  binaryToNumber,
  concat,
  countHits,
  indexes,
  interleave,
  invert,
  onOffPattern,
  or,
  palindrome,
  patternToString,
  repeat,
  reverse,
  rotate,
  sieve,
  spread,
  stretch,
  xor,
} from './transforms';

const text = patternToString;

describe('rotate', () => {
  it('shifts left for a positive number, right for a negative one, wrapping', () => {
    expect(rotate([1, 2, 3, 4], 1)).toEqual([2, 3, 4, 1]);
    expect(rotate([1, 2, 3, 4], -1)).toEqual([4, 1, 2, 3]);
    expect(rotate('x..x....', 1)).toEqual([0, 0, 1, 0, 0, 0, 0, 1]);
    expect(rotate([1, 2, 3, 4], 0)).toEqual([1, 2, 3, 4]);
    expect(rotate([1, 2, 3, 4], 4)).toEqual([1, 2, 3, 4]);
    expect(rotate([1, 2, 3, 4], 5)).toEqual([2, 3, 4, 1]);
    expect(rotate([1, 2, 3, 4], -9)).toEqual([4, 1, 2, 3]);
  });
  it('goes the same way as the rotate argument of euclid', () => {
    expect(rotate(euclid(3, 8), 1)).toEqual(euclid(3, 8, 1));
    for (let steps = 1; steps <= 12; steps++)
      for (let hits = 0; hits <= steps; hits++)
        for (let by = -steps - 1; by <= steps + 1; by++)
          expect(rotate(euclid(hits, steps), by)).toEqual(euclid(hits, steps, by));
  });
  it('undoes itself with the opposite number', () => {
    const p = [3, 0, 0, 2, 0, 1, 0];
    expect(rotate(rotate(p, 3), -3)).toEqual(p);
  });
  it('gives an empty pattern for an empty one, and rejects fractions', () => {
    expect(rotate([], 3)).toEqual([]);
    expect(() => rotate([1, 0], 0.5)).toThrow(RangeError);
    expect(() => rotate([1, 0], NaN)).toThrow(RangeError);
  });
});

describe('reverse', () => {
  it('plays the pattern backwards', () => {
    expect(reverse([1, 0, 2, 3])).toEqual([3, 2, 0, 1]);
    expect(reverse('x.xx....')).toEqual([0, 0, 0, 0, 1, 1, 0, 1]);
    expect(reverse([])).toEqual([]);
    expect(reverse([5])).toEqual([5]);
  });
  it('twice gives the original', () => {
    const p = [3, 0, 0, 2, 0, 1, 0];
    expect(reverse(reverse(p))).toEqual(p);
  });
});

describe('invert', () => {
  it('swaps hits and rests', () => {
    expect(invert('x..x')).toEqual([0, 1, 1, 0]);
    expect(invert([0.5, 0, 3, 0])).toEqual([0, 1, 0, 1]);
    expect(invert([])).toEqual([]);
  });
  it('gives the new hits the value asked for', () => {
    expect(invert('x..x', 0.5)).toEqual([0, 0.5, 0.5, 0]);
  });
  it('twice gives the same rhythm', () => {
    expect(text(invert(invert('x..x.xx.')))).toBe('x..x.xx.');
  });
});

describe('stretch and spread', () => {
  it('stretch holds each step', () => {
    expect(stretch('x.', 2)).toEqual([1, 1, 0, 0]);
    expect(stretch([2, 0, 3], 3)).toEqual([2, 2, 2, 0, 0, 0, 3, 3, 3]);
  });
  it('spread follows each step with rests', () => {
    expect(spread('xx.', 2)).toEqual([1, 0, 1, 0, 0, 0]);
    expect(spread([2, 0, 3], 3)).toEqual([2, 0, 0, 0, 0, 0, 3, 0, 0]);
    expect(countHits(spread(euclid(5, 8), 4))).toBe(5);
  });
  it('a factor of 1 changes nothing, and empty stays empty', () => {
    expect(stretch([1, 0, 2], 1)).toEqual([1, 0, 2]);
    expect(spread([1, 0, 2], 1)).toEqual([1, 0, 2]);
    expect(stretch([], 4)).toEqual([]);
    expect(spread('', 4)).toEqual([]);
  });
  it('rejects factors that are not whole numbers of 1 or more, and results that are too long', () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => stretch('x.', bad)).toThrow(RangeError);
      expect(() => spread('x.', bad)).toThrow(RangeError);
    }
    expect(() => stretch('x.', MAX_PATTERN_STEPS)).toThrow(/steps long/);
    expect(() => spread('x.', MAX_PATTERN_STEPS)).toThrow(/steps long/);
  });
});

describe('palindrome', () => {
  it('goes forwards then backwards, playing the turning points once', () => {
    expect(palindrome([1, 2, 3])).toEqual([1, 2, 3, 2]);
    expect(palindrome([1, 2, 3, 4])).toEqual([1, 2, 3, 4, 3, 2]);
    expect(palindrome('x..')).toEqual([1, 0, 0, 0]);
  });
  it('plays the turning points twice when asked', () => {
    expect(palindrome([1, 2, 3], true)).toEqual([1, 2, 3, 3, 2, 1]);
  });
  it('handles very short patterns', () => {
    expect(palindrome([])).toEqual([]);
    expect(palindrome([], true)).toEqual([]);
    expect(palindrome([7])).toEqual([7]);
    expect(palindrome([7], true)).toEqual([7, 7]);
    expect(palindrome([1, 2])).toEqual([1, 2]);
    expect(palindrome([1, 2], true)).toEqual([1, 2, 2, 1]);
  });
});

describe('repeat and concat', () => {
  it('repeat plays the pattern several times', () => {
    expect(repeat('x.', 3)).toEqual([1, 0, 1, 0, 1, 0]);
    expect(repeat([1, 2], 1)).toEqual([1, 2]);
    expect(repeat([1, 2], 0)).toEqual([]);
    expect(repeat([], 5)).toEqual([]);
  });
  it('repeat rejects bad counts and results that are too long', () => {
    for (const bad of [-1, 1.5, NaN]) expect(() => repeat('x.', bad)).toThrow(RangeError);
    expect(() => repeat('x.', 1e9)).toThrow(/steps long/);
  });
  it('concat puts patterns one after another', () => {
    expect(concat('x..', [0, 2])).toEqual([1, 0, 0, 0, 2]);
    expect(concat([1], [], '', 'x')).toEqual([1, 1]);
    expect(concat()).toEqual([]);
    expect(concat([1, 2])).toEqual([1, 2]);
  });
});

describe('and, or, xor', () => {
  it('and keeps hits that both have, with the value of the first', () => {
    expect(and('xx..', 'x.x.')).toEqual([1, 0, 0, 0]);
    expect(and([3, 2, 0, 5], 'x.xx')).toEqual([3, 0, 0, 5]);
    expect(and([1, 1, 1, 1], [0, 7, 0, 7])).toEqual([0, 1, 0, 1]);
  });
  it('or has the hits of both, preferring the value of the first', () => {
    expect(or('x...', '..x.')).toEqual([1, 0, 1, 0]);
    expect(or([3, 0, 0, 0], [5, 6, 0, 0])).toEqual([3, 6, 0, 0]);
  });
  it('xor has the hits that only one has, with their own value', () => {
    expect(xor('xx..', 'x.x.')).toEqual([0, 1, 1, 0]);
    expect(xor([3, 4, 0, 0], [5, 0, 6, 0])).toEqual([0, 4, 6, 0]);
  });
  it('repeats patterns of different lengths until they line up', () => {
    expect(and('x.x', 'xx')).toEqual([1, 0, 1, 1, 0, 1]);
    expect(or('x..', 'x.')).toEqual([1, 0, 1, 1, 1, 0]);
    expect(xor('x..', 'x.')).toEqual([0, 0, 1, 1, 1, 0]);
    expect(or(euclid(1, 3), euclid(1, 4))).toHaveLength(12);
    expect(or('x...', 'x.......')).toHaveLength(8);
    // The shorter one repeating is the same as writing it out.
    expect(or('x..x..x.', 'x.')).toEqual(or('x..x..x.', 'x.x.x.x.'));
  });
  it('treats an empty pattern as all rests', () => {
    expect(and('x.x', [])).toEqual([0, 0, 0]);
    expect(and([], 'x.x')).toEqual([0, 0, 0]);
    expect(or('x.x', '')).toEqual([1, 0, 1]);
    expect(or([], [0, 2])).toEqual([0, 2]);
    expect(xor('x.x', [])).toEqual([1, 0, 1]);
    expect(and([], [])).toEqual([]);
    expect(or([], [])).toEqual([]);
    expect(xor([], [])).toEqual([]);
  });
  it('refuses patterns that only line up after too many steps', () => {
    const a = repeat('x', 127);
    const b = repeat('x', 128);
    expect(() => or(a, b)).toThrow(/16256 steps/);
    expect(() => and(a, b)).toThrow(RangeError);
    expect(() => xor(a, b)).toThrow(RangeError);
    expect(or(repeat('x', 64), repeat('x', 64))).toHaveLength(64);
  });
  it('follow the rules of logic', () => {
    const a = euclid(3, 8);
    const b = euclid(5, 8, 2);
    expect(text(xor(a, b))).toBe(text(and(or(a, b), invert(and(a, b)))));
    expect(text(invert(or(a, b)))).toBe(text(and(invert(a), invert(b))));
    expect(text(or(a, a))).toBe(text(a));
    expect(countHits(xor(a, a))).toBe(0);
  });
});

describe('interleave', () => {
  it('takes a step from each in turn', () => {
    expect(interleave('xx', '..')).toEqual([1, 0, 1, 0]);
    expect(interleave([1, 2], [3, 4], [5, 6])).toEqual([1, 3, 5, 2, 4, 6]);
    expect(interleave([1, 2, 3])).toEqual([1, 2, 3]);
  });
  it('starts shorter patterns over until the longest has finished', () => {
    expect(interleave([1, 2, 3], [9])).toEqual([1, 9, 2, 9, 3, 9]);
    expect(interleave([1, 2, 3], [8, 9])).toEqual([1, 8, 2, 9, 3, 8]);
  });
  it('leaves out empty patterns', () => {
    expect(interleave()).toEqual([]);
    expect(interleave([], '')).toEqual([]);
    expect(interleave([1, 2], [])).toEqual([1, 2]);
  });
  it('is spread when the other pattern is rests', () => {
    expect(interleave(euclid(3, 8), [0])).toEqual(spread(euclid(3, 8), 2));
  });
});

describe('indexes, countHits, patternToString', () => {
  it('indexes lists where the hits are', () => {
    expect(indexes([1, 0, 1, 1, 0])).toEqual([0, 2, 3]);
    expect(indexes('x..x..x.')).toEqual([0, 3, 6]);
    expect(indexes([0, 0])).toEqual([]);
    expect(indexes([])).toEqual([]);
    expect(indexes([0, -1, 0.5])).toEqual([1, 2]);
  });
  it('countHits counts them', () => {
    expect(countHits('x..x..x.')).toBe(3);
    expect(countHits([0, 2, 0.5, 0])).toBe(2);
    expect(countHits([])).toBe(0);
    expect(countHits(euclid(7, 16))).toBe(7);
  });
  it('patternToString writes x and .', () => {
    expect(patternToString([1, 0, 0, 1])).toBe('x..x');
    expect(patternToString([2, 0, 0.5])).toBe('x.x');
    expect(patternToString([])).toBe('');
    expect(patternToString('x.|.x')).toBe('x..x');
    expect(patternToString(euclid(3, 8))).toBe('x..x..x.');
  });
});

describe('binaryPattern and binaryToNumber', () => {
  it('writes a number in binary, biggest digit first, as Euclip does', () => {
    expect(binaryPattern(5)).toEqual([1, 0, 1]);
    expect(binaryPattern(0)).toEqual([0]);
    expect(binaryPattern(1)).toEqual([1]);
    expect(binaryPattern(13)).toEqual([1, 1, 0, 1]);
    expect(binaryPattern(127)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(binaryPattern(5.9)).toEqual([1, 0, 1]);
    expect(binaryPattern(-3)).toEqual([0]);
    expect(binaryPattern(NaN)).toEqual([0]);
    expect(binaryPattern('6' as never)).toEqual([1, 1, 0]);
    expect(binaryPattern(undefined as never)).toEqual([0]);
  });
  it('goes past the 127 that Euclip stops at', () => {
    expect(binaryPattern(128)).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(binaryPattern(0xabcd).join('')).toBe('1010101111001101');
    expect(binaryPattern(Infinity)).toHaveLength(53);
  });
  it('fits a length: rests at the front, or the front digits dropped', () => {
    expect(binaryPattern(5, 8)).toEqual([0, 0, 0, 0, 0, 1, 0, 1]);
    expect(binaryPattern(0, 4)).toEqual([0, 0, 0, 0]);
    expect(binaryPattern(5, 3)).toEqual([1, 0, 1]);
    expect(binaryPattern(13, 3)).toEqual([1, 0, 1]);
    expect(binaryPattern(0xa5, 16).join('')).toBe('0000000010100101');
    for (const bad of [0, -1, 2.5, NaN]) expect(() => binaryPattern(5, bad)).toThrow(RangeError);
  });
  it('reads a pattern back as a number', () => {
    expect(binaryToNumber('x.x')).toBe(5);
    expect(binaryToNumber([0, 0, 1, 0, 1])).toBe(5);
    expect(binaryToNumber([0.5, 0, 7])).toBe(5);
    expect(binaryToNumber([])).toBe(0);
    expect(binaryToNumber([0])).toBe(0);
    expect(binaryToNumber(euclid(3, 8))).toBe(0b10010010);
    expect(() => binaryToNumber(repeat('x', 54))).toThrow(RangeError);
    expect(binaryToNumber(repeat('x', 53))).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('round trips', () => {
    for (const n of [0, 1, 2, 5, 127, 128, 255, 1000, 65535, 2 ** 40 + 3]) {
      expect(binaryToNumber(binaryPattern(n))).toBe(n);
      expect(binaryToNumber(binaryPattern(n, 48))).toBe(n);
    }
    for (const p of ['x', 'x..x', 'xxxx', 'x.x.x.x.']) {
      expect(text(binaryPattern(binaryToNumber(p)))).toBe(p);
    }
    expect(text(binaryPattern(binaryToNumber('..x.x'), 5))).toBe('..x.x');
  });
});

describe('onOffPattern', () => {
  it('is hits then rests, repeated, as in Euclip', () => {
    expect(onOffPattern(3, 2, 2)).toEqual([1, 1, 1, 0, 0, 1, 1, 1, 0, 0]);
    expect(onOffPattern(1, 3, 4)).toEqual(euclid(4, 16));
    expect(onOffPattern(2, 0, 2)).toEqual([1, 1, 1, 1]);
    expect(onOffPattern(0, 2, 2)).toEqual([0, 0, 0, 0]);
    expect(onOffPattern(2.9, 1.2, 1.9)).toEqual([1, 1, 0]);
    expect(onOffPattern(-1, 2, 1)).toEqual([0, 0]);
    expect(onOffPattern('2' as never, '1' as never, '2' as never)).toEqual([1, 1, 0, 1, 1, 0]);
  });
  it('plays the group once when times is left out', () => {
    expect(onOffPattern(3, 2)).toEqual([1, 1, 1, 0, 0]);
  });
  it('is empty with no group or no repeats', () => {
    expect(onOffPattern(0, 0, 4)).toEqual([]);
    expect(onOffPattern(3, 2, 0)).toEqual([]);
    expect(onOffPattern(3, 2, -1)).toEqual([]);
    expect(onOffPattern(NaN, NaN, NaN)).toEqual([]);
  });
  it('stops at the longest pattern allowed, mid-group if need be', () => {
    const long = onOffPattern(3, 2, 1e9);
    expect(long).toHaveLength(MAX_PATTERN_STEPS);
    expect(long.slice(-3)).toEqual(
      [0, 1, 0].map((_, i) => ((MAX_PATTERN_STEPS - 3 + i) % 5 < 3 ? 1 : 0)),
    );
    expect(onOffPattern(Infinity, 0, 1)).toHaveLength(MAX_PATTERN_STEPS);
  });
});

describe('sieve', () => {
  it('has a hit on every step in one of its classes', () => {
    expect(sieve(8, [3, 0])).toEqual([1, 0, 0, 1, 0, 0, 1, 0]);
    expect(sieve(12, [3, 0], [4, 1])).toEqual([1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0]);
    expect(indexes(sieve(12, [3, 0], [4, 1]))).toEqual([0, 1, 3, 5, 6, 9]);
    expect(sieve(4, [1, 0])).toEqual([1, 1, 1, 1]);
  });
  it('takes the offset as 0 when it is left out, and wraps offsets outside the modulus', () => {
    expect(sieve(8, [3])).toEqual(sieve(8, [3, 0]));
    expect(sieve(8, [4, 5])).toEqual(sieve(8, [4, 1]));
    expect(sieve(8, [4, -1])).toEqual(sieve(8, [4, 3]));
    expect(sieve(8, [4, -1])).toEqual([0, 0, 0, 1, 0, 0, 0, 1]);
  });
  it('is one period long without a length', () => {
    expect(sieve([2, 0], [3, 0])).toEqual([1, 0, 1, 1, 1, 0]);
    expect(sieve([4, 1])).toEqual([0, 1, 0, 0]);
    expect(sieve([4, 0], [6, 1])).toHaveLength(12);
    expect(sieve([3, 0], [3, 1])).toEqual([1, 1, 0]);
  });
  it('repeats with its period, so a longer one is the short one repeated', () => {
    expect(sieve(12, [2, 0], [3, 0])).toEqual(repeat(sieve([2, 0], [3, 0]), 2));
  });
  it('with a length and no classes is all rests', () => {
    expect(sieve(4)).toEqual([0, 0, 0, 0]);
  });
  it('rejects bad input with a plain message', () => {
    expect(() => sieve()).toThrow(RangeError);
    expect(() => sieve(0, [3, 0])).toThrow(/length must be a whole number, 1 or more/);
    expect(() => sieve(2.5, [3, 0])).toThrow(RangeError);
    expect(() => sieve(8, [0, 0])).toThrow(/modulus must be a whole number, 1 or more, got 0/);
    expect(() => sieve(8, [-3, 0])).toThrow(RangeError);
    expect(() => sieve(8, [2.5, 0])).toThrow(RangeError);
    expect(() => sieve(8, [3, 0.5])).toThrow(/offset must be a whole number/);
    expect(() => sieve(8, 3 as never)).toThrow(/\[modulus, offset\]/);
    expect(() => sieve(8, [] as never)).toThrow(RangeError);
    expect(() => sieve(8, [3, 0, 1] as never)).toThrow(RangeError);
    expect(() => sieve(MAX_PATTERN_STEPS + 1, [3, 0])).toThrow(/steps long/);
    expect(() => sieve([127, 0], [128, 0])).toThrow(/give a length/);
    expect(sieve(16, [127, 0], [128, 0])).toHaveLength(16);
  });
  it('combines with the other helpers: intersection and complement', () => {
    // Steps in both "every 3rd" and "every 4th" are every 12th.
    expect(and(sieve(24, [3]), sieve(24, [4]))).toEqual(sieve(24, [12]));
    // Different lengths line up by themselves.
    expect(and(sieve([3]), sieve([4]))).toEqual(sieve([12]));
    expect(or(sieve([3]), sieve([4]))).toEqual(sieve([3], [4]));
    expect(invert(sieve(6, [2, 0]))).toEqual(sieve(6, [2, 1]));
  });
  it('makes scales', () => {
    expect(indexes(sieve(12, [2, 0]))).toEqual([...scales('wholetone')]);
    expect(indexes(sieve(12, [2, 0], [5, 1]))).toEqual([0, 1, 2, 4, 6, 8, 10, 11]);
    // The diminished (octatonic) scale: everything except every third semitone from 2.
    expect(indexes(invert(sieve(12, [3, 2])))).toEqual([0, 1, 3, 4, 6, 7, 9, 10]);
  });
});

describe('known rhythms', () => {
  it('the tresillo is a sieve and a Euclidean rhythm', () => {
    expect(sieve(8, [3, 0])).toEqual(euclid(3, 8));
    expect(text(sieve(8, [3, 0]))).toBe('x..x..x.');
  });
  it('the son clave is a tresillo followed by two hits', () => {
    expect(text(concat(euclid(3, 8), rotate('x.x.....', -2)))).toBe('x..x..x...x.x...');
    expect(
      text(or(concat(sieve(8, [3]), repeat('.', 8)), rotate(concat('x.x.', repeat('.', 12)), -10))),
    ).toBe('x..x..x...x.x...');
  });
  it('the cinquillo is two tresillos, one starting two steps late', () => {
    expect(text(or(sieve(8, [3, 0]), sieve(8, [3, 2])))).toBe('x.xx.xx.');
    expect(or(sieve(8, [3, 0]), sieve(8, [3, 2]))).toEqual(euclid(5, 8));
  });
  it('three against four', () => {
    expect(text(or(spread('xxx', 4), spread('xxxx', 3)))).toBe('x..xx.x.xx..');
    expect(text(or('x...', 'x..'))).toBe('x..xx.x.xx..');
  });
});

describe('inputs are left alone', () => {
  it('no helper changes the list it was given', () => {
    const a = Object.freeze([3, 0, 0, 2, 0, 1, 0, 0]);
    const b = Object.freeze([1, 1, 0]);
    const results: number[][] = [
      rotate(a, 3),
      reverse(a),
      invert(a),
      stretch(a, 2),
      spread(a, 2),
      palindrome(a),
      palindrome(a, true),
      repeat(a, 2),
      repeat(a, 1),
      and(a, b),
      or(a, b),
      xor(a, b),
      interleave(a, b),
      interleave(a),
      concat(a, b),
      concat(a),
      indexes(a),
      rotate(a, 0),
    ];
    binaryToNumber(a);
    countHits(a);
    patternToString(a);
    expect(a).toEqual([3, 0, 0, 2, 0, 1, 0, 0]);
    expect(b).toEqual([1, 1, 0]);
    for (const result of results) {
      expect(result).not.toBe(a);
      expect(Array.isArray(result)).toBe(true);
    }
  });
  it('rejects steps that are not numbers, like parsePattern', () => {
    expect(() => reverse([1, NaN])).toThrow(RangeError);
    expect(() => or('x.q', 'x')).toThrow(RangeError);
    expect(() => concat('1 a')).toThrow(RangeError);
  });
});
