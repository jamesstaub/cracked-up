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
