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
