import type { Random } from '../api';

/**
 * Seeded random source using mulberry32. Same seed, same sequence; `seed(v)` restarts it.
 *
 * `chance(p)` always consumes exactly one draw, even when p <= 0 (false) or p >= 1 (true), so the
 * stream position does not depend on the probabilities passed. `pick([])` consumes nothing.
 */
export function createRandom(seed: number): Random {
  let state = 0;

  const reseed = (value: number): void => {
    state = Number.isFinite(value) ? Math.floor(value) >>> 0 : 0;
  };

  const float = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  reseed(seed);

  return {
    seed: reseed,
    float,
    int(min, max) {
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      return lo + Math.floor(float() * (hi - lo + 1));
    },
    chance(probability) {
      const r = float();
      if (probability <= 0) return false;
      if (probability >= 1) return true;
      return r < probability;
    },
    pick(items) {
      if (items.length === 0) return undefined;
      return items[Math.floor(float() * items.length)];
    },
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(float() * (i + 1));
        const a = out[i] as (typeof out)[number];
        out[i] = out[j] as (typeof out)[number];
        out[j] = a;
      }
      return out;
    },
  };
}

/**
 * Where a helper gets its random numbers: a `Random` (from `createRandom(seed)`, or `engine.random`),
 * or any function that returns a number from 0 up to but not including 1, such as `Math.random`.
 */
export type RandomSource = Random | (() => number);

/** One number from 0 up to (not including) 1 from the source, or from `Math.random` without one. */
function draw(source: RandomSource | undefined): number {
  if (source === undefined) return Math.random();
  return typeof source === 'function' ? source() : source.float();
}

/**
 * A random whole number from `min` to `max`, both included, each equally likely.
 * `randomInt(1, 6)` is a dice roll. Pass a seeded source as the last argument to get the same
 * numbers every time: `randomInt(1, 6, createRandom(7))`.
 *
 * Cracked called this `random`. Its version rounded, which made `min` and `max` come up half as
 * often as the numbers between them; this one does not have that fault.
 */
export function randomInt(min: number, max: number, source?: RandomSource): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return lo + Math.floor(draw(source) * (hi - lo + 1));
}

/** The Cracked name for `randomInt`. */
export const random = randomInt;

/** A random number from `min` up to (not including) `max`, fractions included. */
export function randomFloat(min: number, max: number, source?: RandomSource): number {
  return min + draw(source) * (max - min);
}

/**
 * True that often: `chance(0.25)` is true about one time in four. 0 is never, 1 is always.
 *
 * Cracked's `chance` took a percentage from 0 to 100. This one takes 0 to 1, like every other
 * probability in the library.
 */
export function chance(probability: number, source?: RandomSource): boolean {
  // Always one draw, so what comes next from a seeded source does not depend on the probability.
  return draw(source) < probability;
}

/** One item from the list, chosen at random. An empty list gives `undefined`. */
export function pick<T>(items: readonly T[], source?: RandomSource): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(draw(source) * items.length)];
}

/**
 * The same items in a random order, as a new list. The list you pass in is left as it was.
 * (Cracked's `shuffle` reordered the list it was given.)
 */
export function shuffle<T>(items: readonly T[], source?: RandomSource): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(draw(source) * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/**
 * Four random lengths that add up to `length`: for example the attack, decay, sustain and release
 * times of an envelope that lasts `length` seconds in all.
 */
export function randomEnvelope(length: number, source?: RandomSource): number[] {
  const parts = [draw(source), draw(source), draw(source), draw(source)];
  const sum = parts.reduce((a, b) => a + b, 0);
  // Four zeros in a row is next to impossible, but dividing by it would give NaN.
  if (sum === 0) return parts.map(() => length / 4);
  return parts.map((part) => (part * length) / sum);
}

/** The Cracked name for `randomEnvelope`. */
export const random_envelope = randomEnvelope;
