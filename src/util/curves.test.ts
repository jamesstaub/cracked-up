import { describe, expect, it } from 'vitest';
import { clampToMeta, fromNormalized, toNormalized } from './curves';

const lin = { min: 0, max: 10, curve: 'linear' } as const;
const log = { min: 20, max: 20000, curve: 'log' } as const;
const exp = { min: 0, max: 4, curve: 'exp' } as const;

describe('curves', () => {
  it('linear', () => {
    expect(toNormalized(5, lin)).toBe(0.5);
    expect(fromNormalized(0.25, lin)).toBe(2.5);
  });
  it('log gives equal ratios equal distance', () => {
    expect(toNormalized(20, log)).toBeCloseTo(0, 12);
    expect(toNormalized(20000, log)).toBeCloseTo(1, 12);
    expect(toNormalized(632.455532, log)).toBeCloseTo(0.5, 6);
    expect(fromNormalized(0.5, log)).toBeCloseTo(632.455532, 5);
  });
  it('log falls back to linear when min <= 0', () => {
    const m = { min: 0, max: 100, curve: 'log' } as const;
    expect(toNormalized(50, m)).toBe(0.5);
    expect(fromNormalized(0.5, m)).toBe(50);
  });
  it('exp is finer near min', () => {
    expect(fromNormalized(0.5, exp)).toBe(1);
    expect(toNormalized(1, exp)).toBeCloseTo(0.5, 12);
  });
  it('clamps', () => {
    for (const m of [lin, log, exp]) {
      expect(toNormalized(-1e9, m)).toBe(0);
      expect(toNormalized(1e9, m)).toBe(1);
      expect(fromNormalized(-1, m)).toBe(m.min);
      expect(fromNormalized(2, m)).toBe(m.max);
    }
  });
  it('round-trips', () => {
    for (const m of [lin, log, exp, { min: -50, max: 50, curve: 'exp' } as const]) {
      for (let i = 0; i <= 100; i++) {
        const v = m.min + ((m.max - m.min) * i) / 100;
        expect(Math.abs(fromNormalized(toNormalized(v, m), m) - v)).toBeLessThan(
          1e-9 * Math.max(1, Math.abs(v)),
        );
        const p = i / 100;
        expect(Math.abs(toNormalized(fromNormalized(p, m), m) - p)).toBeLessThan(1e-9);
      }
    }
  });
});

describe('clampToMeta', () => {
  it('clamps', () => {
    expect(clampToMeta(-5, { min: 0, max: 10 })).toBe(0);
    expect(clampToMeta(50, { min: 0, max: 10 })).toBe(10);
    expect(clampToMeta(3.3, { min: 0, max: 10 })).toBe(3.3);
  });
  it('snaps to step relative to min', () => {
    expect(clampToMeta(3.3, { min: 0, max: 10, step: 1 })).toBe(3);
    expect(clampToMeta(3.3, { min: 0.5, max: 10, step: 1 })).toBe(3.5);
    expect(clampToMeta(0.3, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(clampToMeta(9.9, { min: 0, max: 10, step: 4 })).toBe(8);
  });
});
