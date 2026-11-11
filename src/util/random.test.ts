import { describe, expect, it } from 'vitest';
import { createRandom } from './random';

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
