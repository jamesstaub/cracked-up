import type { Pattern } from '../api';

const COMPACT = /^[xX.\-_ |]+$/;

/**
 * Turns a Pattern into a fresh array of step values.
 * Strings: compact form (`x`/`X` = 1; `.`, `-`, `_` = 0; spaces and `|` ignored) when every
 * non-separator character is one of those, otherwise space/comma-separated numbers.
 * Throws RangeError for empty or invalid patterns.
 */
export function parsePattern(pattern: Pattern): number[] {
  let result: number[];
  if (typeof pattern === 'string') {
    if (COMPACT.test(pattern)) {
      result = [];
      for (const ch of pattern) {
        if (ch === 'x' || ch === 'X') result.push(1);
        else if (ch === '.' || ch === '-' || ch === '_') result.push(0);
      }
    } else {
      const tokens = pattern.split(/[\s,]+/).filter((t) => t !== '');
      result = tokens.map((t) => {
        const n = Number(t);
        if (!Number.isFinite(n))
          throw new RangeError(`Invalid pattern token "${t}" in "${pattern}"`);
        return n;
      });
    }
  } else {
    result = pattern.map((n) => {
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        throw new RangeError(`Invalid pattern step ${String(n)}: steps must be finite numbers`);
      }
      return n;
    });
  }
  if (result.length === 0) throw new RangeError('Pattern is empty');
  return result;
}

/**
 * Euclidean rhythm (Bjorklund): `hits` pulses spread as evenly as possible over `steps`.
 * The first step is a hit for rotate 0. `rotate` shifts the pattern left by that many steps,
 * wrapping; negative rotates right. `hits` is clamped to 0..steps.
 */
export function euclid(hits: number, steps: number, rotate = 0): number[] {
  if (!Number.isInteger(steps) || steps < 1) {
    throw new RangeError(`euclid: steps must be an integer >= 1, got ${steps}`);
  }
  if (!Number.isInteger(hits)) throw new RangeError(`euclid: hits must be an integer, got ${hits}`);
  if (!Number.isInteger(rotate))
    throw new RangeError(`euclid: rotate must be an integer, got ${rotate}`);
  const k = Math.min(Math.max(hits, 0), steps);

  let first: number[][] = Array.from({ length: k }, () => [1]);
  let second: number[][] = Array.from({ length: steps - k }, () => [0]);
  let min = Math.min(first.length, second.length);
  let threshold = 0;
  while (min > threshold) {
    threshold = 1;
    const wasFirstSmaller = min === first.length;
    for (let i = 0; i < min; i++) first[i] = [...(first[i] ?? []), ...(second[i] ?? [])];
    if (wasFirstSmaller) {
      second = second.slice(min);
    } else {
      second = first.slice(min);
      first = first.slice(0, min);
    }
    min = Math.min(first.length, second.length);
  }
  const base = [...first, ...second].flat();
  const shift = ((rotate % steps) + steps) % steps;
  return [...base.slice(shift), ...base.slice(0, shift)];
}

/**
 * A list of `size` values. With a function, each value is what the function returns for that
 * position (counting from 0): `fillArray(4, (i) => i * 2)` is `[0, 2, 4, 6]`. Without one, the
 * list is all zeros.
 */
export function fillArray(size: number): number[];
export function fillArray<T>(size: number, fn: (index: number) => T): T[];
export function fillArray<T>(size: number, fn?: (index: number) => T): (T | number)[] {
  const count = Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0;
  return Array.from({ length: count }, (_, index) => (fn ? fn(index) : 0));
}

/** The Cracked name for `fillArray`. */
export const fill_array = fillArray;

/** Where `arrayNext` has got to in each list it has been given. */
const positions = new WeakMap<object, number>();

/**
 * Steps through a list one item per call, and starts over after the last one. The first call gives
 * the first item. The place is remembered for each list, so keep the list in a variable and pass
 * the same one every time.
 *
 * `offset` and `limit` narrow it to part of the list: items from position `offset` up to (not
 * including) position `limit`. `onWrap` is called each time it starts over.
 */
export function arrayNext<T>(
  items: readonly T[],
  offset = 0,
  limit = items.length,
  onWrap?: () => void,
): T | undefined {
  if (items.length === 0) return undefined;
  const end = Math.min(Math.max(Math.floor(limit) || items.length, 1), items.length);
  const start = Math.min(Math.max(Math.floor(offset) || 0, 0), end - 1);
  const previous = positions.get(items) ?? -1;
  const wrapped = start + previous + 1 >= end;
  const index = wrapped ? 0 : previous + 1;
  positions.set(items, index);
  if (wrapped && previous >= 0 && onWrap) onWrap();
  return items[start + index];
}

/** The Cracked name for `arrayNext`. */
export const array_next = arrayNext;

/**
 * Makes a counter that says yes on every nth call: `const third = everyNth(3)` gives a function
 * that returns false, false, true, false, false, true, and so on. Call it once per step to do
 * something on every third step.
 */
export function everyNth(n: number): () => boolean {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`everyNth: n must be an integer >= 1, got ${n}`);
  }
  let calls = 0;
  return () => {
    calls++;
    return calls % n === 0;
  };
}

/** The Cracked name for `everyNth`. */
export const throttle_factory = everyNth;

/**
 * Makes a function that holds each position of a list for a number of calls. `counts` says how
 * many calls each position lasts: with `[4, 2]`, calls 1 to 4 are position 0, calls 5 and 6 are
 * position 1, then it starts over. Call it once per step, for example to stay on one chord for
 * four steps and the next for two.
 *
 * Each call returns the position. If you pass `fn`, it is also called every time with `changed`
 * (true on the first call of each position) and the position.
 * Counts of zero or less are skipped.
 */
export function holdSteps(
  counts: readonly number[],
  fn?: (changed: boolean, index: number) => void,
): () => number {
  const held = counts
    .map((count, index) => ({ count: Math.floor(count), index }))
    .filter((entry) => entry.count >= 1);
  if (held.length === 0) {
    throw new RangeError('holdSteps: counts needs at least one number that is 1 or more');
  }
  let at = 0;
  let calls = 0;
  return () => {
    let current = held[at]!;
    if (calls === current.count) {
      at = (at + 1) % held.length;
      current = held[at]!;
      calls = 0;
    }
    calls++;
    fn?.(calls === 1, current.index);
    return current.index;
  };
}

/** The Cracked name for `holdSteps`. */
export const sequence_factory = holdSteps;
