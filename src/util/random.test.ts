import { describe, expect, it } from 'vitest';
import {
  chance,
  createRandom,
  pick,
  random,
  randomEnvelope,
  randomFloat,
  randomInt,
  random_envelope,
  shuffle,
} from './random';

const draw = (r: ReturnType<typeof createRandom>, n: number) =>
  Array.from({ length: n }, () => r.float());

describe('createRandom', () => {
  it('is deterministic for a seed', () => {
    expect(draw(createRandom(42), 20)).toEqual(draw(createRandom(42), 20));
    expect(draw(createRandom(42), 5)).not.toEqual(draw(createRandom(43), 5));
  });
  it('seed() restarts the sequence', () => {
    const r = createRandom(7);
    const a = draw(r, 10);
    r.seed(7);
    expect(draw(r, 10)).toEqual(a);
  });
  it('float is in [0, 1) and roughly uniform', () => {
    const r = createRandom(1);
    const bins = new Array<number>(10).fill(0);
    for (let i = 0; i < 10000; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      bins[Math.floor(f * 10)]!++;
    }
    for (const b of bins) {
      expect(b).toBeGreaterThan(850);
      expect(b).toBeLessThan(1150);
    }
  });
  it('int is inclusive and swaps min/max', () => {
    const r = createRandom(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(5, 2));
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
    expect(r.int(4, 4)).toBe(4);
  });
  it('chance handles the extremes and keeps the stream aligned', () => {
    const r = createRandom(9);
    expect(r.chance(0)).toBe(false);
    expect(r.chance(-1)).toBe(false);
    expect(r.chance(1)).toBe(true);
    expect(r.chance(2)).toBe(true);
    const a = createRandom(9);
    const b = createRandom(9);
    a.chance(0);
    a.chance(1);
    b.float();
    b.float();
    expect(a.float()).toBe(b.float());
    let hits = 0;
    const c = createRandom(5);
    for (let i = 0; i < 10000; i++) if (c.chance(0.3)) hits++;
    expect(hits).toBeGreaterThan(2800);
    expect(hits).toBeLessThan(3200);
  });
  it('pick', () => {
    const r = createRandom(1);
    expect(r.pick([])).toBeUndefined();
    expect(['a', 'b', 'c']).toContain(r.pick(['a', 'b', 'c']));
  });
  it('shuffle returns a permuted copy without mutating', () => {
    const r = createRandom(11);
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = r.shuffle(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out).not.toBe(src);
    expect([...out].sort()).toEqual(src);
    expect(out).not.toEqual(src);
    expect(createRandom(11).shuffle(src)).toEqual(out);
  });
});

describe('random helpers', () => {
  it('give the same results for the same seed, from a Random or a plain function', () => {
    const run = (seed: number) => {
      const r = createRandom(seed);
      return [
        randomInt(1, 6, r),
        randomFloat(0, 10, r),
        chance(0.5, r),
        pick(['a', 'b', 'c'], r),
        shuffle([1, 2, 3, 4, 5], r),
        randomEnvelope(2, r),
      ];
    };
    expect(run(11)).toEqual(run(11));
    expect(run(11)).not.toEqual(run(12));
    const a = createRandom(5);
    const b = createRandom(5);
    expect(randomInt(0, 1000, a)).toBe(randomInt(0, 1000, () => b.float()));
  });
  it('match the methods of the Random they draw from', () => {
    const a = createRandom(3);
    const b = createRandom(3);
    expect(randomInt(-4, 9, a)).toBe(b.int(-4, 9));
    expect(pick([1, 2, 3, 4], a)).toBe(b.pick([1, 2, 3, 4]));
    expect(shuffle([1, 2, 3, 4, 5, 6], a)).toEqual(b.shuffle([1, 2, 3, 4, 5, 6]));
    expect(chance(0.3, a)).toBe(b.chance(0.3));
  });
  it('use Math.random when no source is given', () => {
    for (let i = 0; i < 50; i++) {
      const n = randomInt(1, 3);
      expect([1, 2, 3]).toContain(n);
      expect([1, 2, 3]).toContain(pick([1, 2, 3]));
    }
    expect(shuffle([1, 2, 3]).sort()).toEqual([1, 2, 3]);
  });
  it('randomInt covers both ends evenly, in either argument order', () => {
    const r = createRandom(1);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 8000; i++) counts[randomInt(3, 0, r)]!++;
    for (const count of counts) {
      expect(count).toBeGreaterThan(1800);
      expect(count).toBeLessThan(2200);
    }
    expect(randomInt(5, 5, r)).toBe(5);
    expect(random).toBe(randomInt);
  });
  it('randomFloat stays in range', () => {
    const r = createRandom(2);
    for (let i = 0; i < 1000; i++) {
      const f = randomFloat(200, 800, r);
      expect(f).toBeGreaterThanOrEqual(200);
      expect(f).toBeLessThan(800);
    }
  });
  it('chance takes 0 to 1 and always uses one draw', () => {
    const r = createRandom(4);
    let hits = 0;
    for (let i = 0; i < 10000; i++) if (chance(0.25, r)) hits++;
    expect(hits).toBeGreaterThan(2300);
    expect(hits).toBeLessThan(2700);
    expect(chance(0, r)).toBe(false);
    expect(chance(1, r)).toBe(true);
    const a = createRandom(9);
    const b = createRandom(9);
    chance(0, a);
    b.float();
    expect(a.float()).toBe(b.float());
  });
  it('pick returns undefined for an empty list and draws nothing', () => {
    const a = createRandom(9);
    const b = createRandom(9);
    expect(pick([], a)).toBeUndefined();
    expect(a.float()).toBe(b.float());
  });
  it('shuffle returns a new list and leaves the original alone', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(items, createRandom(6));
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out).not.toBe(items);
    expect(out).not.toEqual(items);
    expect([...out].sort((x, y) => x - y)).toEqual(items);
  });
  it('randomEnvelope gives four positive parts that add up to the length', () => {
    const parts = randomEnvelope(3, createRandom(8));
    expect(parts).toHaveLength(4);
    for (const part of parts) expect(part).toBeGreaterThan(0);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 10);
    expect(randomEnvelope(2, () => 0)).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(random_envelope).toBe(randomEnvelope);
  });
});
