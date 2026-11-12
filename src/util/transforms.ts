/**
 * Helpers that make patterns and turn one pattern into another: transforms (`rotate`, `reverse`,
 * `invert`, ...), combinations (`and`, `or`, `xor`, `interleave`, `concat`), binary and on/off
 * patterns, and sieves.
 *
 * A pattern is a list of numbers, one per step: 0 is a rest, anything else is a hit, and the number
 * is the value the sequence hands to its callback. Every function here takes a pattern as a list or
 * as a string (`'x..x'`, `'1 0 0 2'`), returns a new list, and leaves what it was given alone.
 */

import type { Pattern } from '../api';
import { parsePattern } from './pattern';

/**
 * The longest pattern these helpers will build. Asking for more is nearly always a slip (a huge
 * repeat count, two long patterns whose lengths share no factor), and would stall the page.
 */
export const MAX_PATTERN_STEPS = 4096;

/** A pattern as a fresh list of steps. Unlike `parsePattern`, nothing gives an empty list. */
function toSteps(pattern: Pattern): number[] {
  const empty = typeof pattern === 'string' ? pattern.trim() === '' : pattern.length === 0;
  return empty ? [] : parsePattern(pattern);
}

/** Throws unless `value` is a whole number of at least `min`. */
function whole(fn: string, name: string, value: number, min?: number): void {
  if (!Number.isInteger(value) || (min !== undefined && value < min)) {
    const range = min === undefined ? 'a whole number' : `a whole number, ${min} or more`;
    throw new RangeError(`${fn}: ${name} must be ${range}, got ${String(value)}`);
  }
}

/** Throws when a result would be longer than `MAX_PATTERN_STEPS`. */
function checkLength(fn: string, length: number): void {
  if (length > MAX_PATTERN_STEPS) {
    throw new RangeError(
      `${fn}: the result would be ${length} steps long; the most is ${MAX_PATTERN_STEPS}`,
    );
  }
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;

// --- Transforms -------------------------------------------------------------------------------------

/**
 * Shifts a pattern round, wrapping. A positive number starts the pattern that many steps later, so
 * every hit comes that many steps earlier; a negative number does the opposite. This is the same
 * direction as the `rotate` argument of `euclid`: `rotate(euclid(3, 8), 1)` is `euclid(3, 8, 1)`.
 *
 * `rotate('x..x....', 1)` is `[0, 0, 1, 0, 0, 0, 0, 1]` (`'..x....x'`).
 */
export function rotate(pattern: Pattern, steps: number): number[] {
  whole('rotate', 'steps', steps);
  const list = toSteps(pattern);
  if (list.length === 0) return list;
  const shift = ((steps % list.length) + list.length) % list.length;
  return [...list.slice(shift), ...list.slice(0, shift)];
}

/**
 * The pattern backwards. `reverse('x.xx....')` is `[0, 0, 0, 0, 1, 1, 0, 1]`.
 *
 * (Nothing to do with the `reverse` setting of a sampler, which plays the sound backwards.)
 */
export function reverse(pattern: Pattern): number[] {
  return toSteps(pattern).reverse();
}

/**
 * Swaps hits and rests: every hit becomes a rest, and every rest becomes a hit with `value`
 * (1 unless you say). `invert('x..x')` is `[0, 1, 1, 0]`.
 */
export function invert(pattern: Pattern, value = 1): number[] {
  return toSteps(pattern).map((step) => (step === 0 ? value : 0));
}

/**
 * Slows a pattern down by holding each step: every step is repeated `factor` times, so a hit
 * becomes that many hits in a row with the same value. `stretch('x.', 2)` is `[1, 1, 0, 0]`.
 * To slow a pattern down and keep the same number of hits, use `spread`.
 */
export function stretch(pattern: Pattern, factor: number): number[] {
  whole('stretch', 'factor', factor, 1);
  const list = toSteps(pattern);
  checkLength('stretch', list.length * factor);
  return list.flatMap((step) => Array.from({ length: factor }, () => step));
}

/**
 * Slows a pattern down by putting rests after each step: every step takes `factor` steps, and a
 * hit is one hit followed by rests. `spread('xx.', 2)` is `[1, 0, 1, 0, 0, 0]`. Played at twice
 * the step rate it sounds the same as the original.
 */
export function spread(pattern: Pattern, factor: number): number[] {
  whole('spread', 'factor', factor, 1);
  const list = toSteps(pattern);
  checkLength('spread', list.length * factor);
  return list.flatMap((step) => Array.from({ length: factor }, (_, i) => (i === 0 ? step : 0)));
}

/**
 * The pattern forwards and then backwards. Normally the turning points are played once, so the
 * result loops smoothly: `palindrome([1, 2, 3])` is `[1, 2, 3, 2]`. With `repeatEnds` true the
 * last and first steps are played twice: `palindrome([1, 2, 3], true)` is `[1, 2, 3, 3, 2, 1]`.
 */
export function palindrome(pattern: Pattern, repeatEnds = false): number[] {
  const list = toSteps(pattern);
  const back = [...list].reverse();
  return [...list, ...(repeatEnds ? back : back.slice(1, -1))];
}

/** The pattern played `times` times in a row. `repeat('x.', 3)` is `[1, 0, 1, 0, 1, 0]`. */
export function repeat(pattern: Pattern, times: number): number[] {
  whole('repeat', 'times', times, 0);
  const list = toSteps(pattern);
  checkLength('repeat', list.length * times);
  return Array.from({ length: times }, () => list).flat();
}

// --- Combining --------------------------------------------------------------------------------------

/**
 * Lines two patterns up step by step. When the lengths differ each pattern repeats until both come
 * round to their start together (3 steps against 4 gives 12). An empty pattern counts as all rests.
 */
function combine(
  fn: string,
  a: Pattern,
  b: Pattern,
  pick: (a: number, b: number) => number,
): number[] {
  const first = toSteps(a);
  const second = toSteps(b);
  if (first.length === 0 && second.length === 0) return [];
  const length =
    first.length === 0
      ? second.length
      : second.length === 0
        ? first.length
        : lcm(first.length, second.length);
  checkLength(fn, length);
  return Array.from({ length }, (_, i) =>
    pick(first[i % first.length] ?? 0, second[i % second.length] ?? 0),
  );
}

/**
 * A hit only where both patterns have a hit. The hit keeps the first pattern's value, so the second
 * works as a mask: `and([3, 2, 0, 5], 'x.xx')` is `[3, 0, 0, 5]`.
 *
 * When the lengths differ, each pattern repeats until they line up again:
 * `and('x.x', 'xx')` is `[1, 0, 1, 1, 0, 1]`.
 */
export function and(a: Pattern, b: Pattern): number[] {
  return combine('and', a, b, (x, y) => (x !== 0 && y !== 0 ? x : 0));
}

/**
 * A hit where either pattern has a hit: the two rhythms laid on top of each other. Where both hit,
 * the first pattern's value is used. `or('x...', '..x.')` is `[1, 0, 1, 0]`.
 *
 * When the lengths differ, each pattern repeats until they line up again:
 * `or('x..', 'x.')` is `[1, 0, 1, 1, 1, 0]`.
 */
export function or(a: Pattern, b: Pattern): number[] {
  return combine('or', a, b, (x, y) => (x !== 0 ? x : y));
}

/**
 * A hit where one pattern has a hit and the other has a rest; where both hit, they cancel. The hit
 * keeps the value it had. `xor('xx..', 'x.x.')` is `[0, 1, 1, 0]`.
 *
 * When the lengths differ, each pattern repeats until they line up again.
 */
export function xor(a: Pattern, b: Pattern): number[] {
  return combine('xor', a, b, (x, y) => (x !== 0 && y !== 0 ? 0 : x !== 0 ? x : y));
}

/**
 * Takes a step from each pattern in turn: the first step of each, then the second of each, and so
 * on. `interleave('xx', '..')` is `[1, 0, 1, 0]`. A shorter pattern starts over while the longest
 * one finishes: `interleave([1, 2, 3], [9])` is `[1, 9, 2, 9, 3, 9]`. Empty patterns are left out.
 */
export function interleave(...patterns: Pattern[]): number[] {
  const lists = patterns.map(toSteps).filter((list) => list.length > 0);
  const longest = Math.max(0, ...lists.map((list) => list.length));
  const result: number[] = [];
  for (let i = 0; i < longest; i++) {
    for (const list of lists) result.push(list[i % list.length] ?? 0);
  }
  return result;
}

/** The patterns one after another. `concat('x..', [0, 2])` is `[1, 0, 0, 0, 2]`. */
export function concat(...patterns: Pattern[]): number[] {
  return patterns.flatMap(toSteps);
}

// --- Reading a pattern ------------------------------------------------------------------------------

/**
 * The positions of the hits, counting from 0. `indexes([1, 0, 1, 1, 0])` is `[0, 2, 3]`.
 *
 * This turns a rhythm into a scale: `indexes(sieve(12, [2, 0], [5, 1]))` is
 * `[0, 1, 2, 4, 6, 8, 10, 11]`, semitones above a root, so
 * `pitchToFreq(60 + pick(indexes(...)))` is a note of that scale.
 */
export function indexes(pattern: Pattern): number[] {
  const result: number[] = [];
  toSteps(pattern).forEach((step, index) => {
    if (step !== 0) result.push(index);
  });
  return result;
}

/** How many hits a pattern has. `countHits('x..x..x.')` is 3. */
export function countHits(pattern: Pattern): number {
  return toSteps(pattern).filter((step) => step !== 0).length;
}

/**
 * A pattern written out as text, `x` for a hit and `.` for a rest, to print it or to compare two
 * patterns by eye. `patternToString(euclid(3, 8))` is `'x..x..x.'`. The values of the hits are not
 * shown: `[2, 0, 0.5]` is `'x.x'`.
 */
export function patternToString(pattern: Pattern): string {
  return toSteps(pattern)
    .map((step) => (step === 0 ? '.' : 'x'))
    .join('');
}

// --- Binary and on/off patterns ---------------------------------------------------------------------

/** A count as Euclip reads one: rounded down, never below 0, and 0 for anything that is not a number. */
const count = (n: number): number => Math.max(0, Math.floor(Number(n) || 0));

/**
 * A whole number written in binary, as steps: each 1 is a hit and each 0 a rest, biggest digit
 * first. `binaryPattern(5)` is `[1, 0, 1]`, `binaryPattern(0)` is `[0]`. Fractions are rounded
 * down, and a negative number (or anything that is not a number) counts as 0.
 *
 * Without `length` the pattern is as long as the number needs, with no rests at the front. With
 * `length` it is exactly that many steps: rests are added at the front, `binaryPattern(5, 8)` is
 * `[0, 0, 0, 0, 0, 1, 0, 1]`, and a number too big to fit loses its front digits,
 * `binaryPattern(13, 3)` is `[1, 0, 1]`.
 */
export function binaryPattern(value: number, length?: number): number[] {
  if (length !== undefined) whole('binaryPattern', 'length', length, 1);
  const digits = Math.min(Number.MAX_SAFE_INTEGER, count(value)).toString(2);
  const sized = length === undefined ? digits : digits.padStart(length, '0').slice(-length);
  return sized.split('').map(Number);
}

/**
 * The opposite of `binaryPattern`: reads a pattern as a binary number, a hit as 1 and a rest as 0,
 * biggest digit first. `binaryToNumber('x.x')` is 5. An empty pattern is 0.
 */
export function binaryToNumber(pattern: Pattern): number {
  const value = toSteps(pattern).reduce((sum, step) => sum * 2 + (step === 0 ? 0 : 1), 0);
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new RangeError('binaryToNumber: the pattern is too long to be an exact number');
  }
  return value;
}

/**
 * `on` hits, then `off` rests, and that group `times` times over (once unless you say).
 * `onOffPattern(3, 2, 2)` is `[1, 1, 1, 0, 0, 1, 1, 1, 0, 0]`.
 *
 * The counts are rounded down, and a negative count is 0. The result is empty when `times` is 0 or
 * both counts are 0, and it stops at `MAX_PATTERN_STEPS` steps.
 */
export function onOffPattern(on: number, off: number, times = 1): number[] {
  const hits = count(on);
  const cycle = hits + count(off);
  const length = cycle === 0 ? 0 : Math.min(cycle * count(times), MAX_PATTERN_STEPS);
  return Array.from({ length }, (_, i) => (i % cycle < hits ? 1 : 0));
}

// --- Sieves -----------------------------------------------------------------------------------------

/**
 * One part of a sieve: "every `modulus`-th step, starting at step `offset`". `[3, 1]` is steps
 * 1, 4, 7, ... and `[4]` is the same as `[4, 0]`: steps 0, 4, 8, ...
 */
export type SieveClass = readonly [modulus: number, offset?: number];

/**
 * A sieve, after Xenakis: a pattern with a hit on every step that belongs to at least one of the
 * given classes. Each class is `[modulus, offset]`, meaning every `modulus`-th step starting at
 * step `offset` (0 if left out).
 *
 * `sieve(8, [3, 0])` is `[1, 0, 0, 1, 0, 0, 1, 0]`, the tresillo.
 * `sieve(12, [3, 0], [4, 1])` has hits on steps 0, 3, 6, 9 and 1, 5, 9.
 *
 * The first argument is the length in steps. Leave it out and the sieve is one full period long,
 * the point where all its classes come round together: `sieve([2, 0], [3, 0])` is 6 steps,
 * `[1, 0, 1, 1, 1, 0]`.
 *
 * A sieve is an ordinary pattern, so the other helpers do the rest: `and(sieve(12, [3]), sieve(12, [4]))`
 * keeps the steps that are in both, `invert(sieve(...))` the steps that are in neither, and
 * `indexes(sieve(...))` gives the step numbers, which makes a sieve a scale.
 */
export function sieve(...classes: SieveClass[]): number[];
export function sieve(length: number, ...classes: SieveClass[]): number[];
export function sieve(...args: (number | SieveClass)[]): number[] {
  const first = args[0];
  const given = typeof first === 'number' ? first : undefined;
  const classes = (given === undefined ? args : args.slice(1)).map((entry) => {
    if (!Array.isArray(entry) || entry.length < 1 || entry.length > 2) {
      throw new RangeError(
        'sieve: each class must be [modulus, offset], for example sieve(12, [3, 0], [4, 1])',
      );
    }
    const [modulus, offset = 0] = entry as SieveClass;
    whole('sieve', 'modulus', modulus, 1);
    whole('sieve', 'offset', offset);
    return { modulus, offset: ((offset % modulus) + modulus) % modulus };
  });
  if (given !== undefined) whole('sieve', 'length', given, 1);
  if (given === undefined && classes.length === 0) {
    throw new RangeError('sieve: give a length, at least one [modulus, offset] class, or both');
  }
  let length = given ?? 1;
  if (given === undefined) {
    for (const { modulus } of classes) {
      length = lcm(length, modulus);
      if (length > MAX_PATTERN_STEPS) {
        throw new RangeError(
          `sieve: these classes only come round together after more than ${MAX_PATTERN_STEPS} steps; give a length as the first argument`,
        );
      }
    }
  }
  checkLength('sieve', length);
  return Array.from({ length }, (_, i) =>
    classes.some(({ modulus, offset }) => i % modulus === offset) ? 1 : 0,
  );
}
