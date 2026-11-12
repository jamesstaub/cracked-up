import { describe, expect, it } from 'vitest';
import { SAMPLE_RATE, constant, offlineEngine } from '../core/setup';
import { goertzel, identical, samples, seededEngine } from './util';

const at = (seconds: number) => Math.round(seconds * SAMPLE_RATE);

describe('lfo', () => {
  it('moves a gain between 0 and 1 at its frequency when it modulates gain', async () => {
    const engine = await offlineEngine(1);
    engine
      .chain()
      .lfo({ frequency: 5, depth: 0.5, modulates: 'gain' })
      .gain({ id: 'vca', gain: 0.5 })
      .to('main');
    constant(engine, 1).connect('#vca');
    const data = samples(await engine.render());
    // gain = 0.5 + 0.5 sin(2 pi 5 t): a quarter period is 0.05 s. Error against that formula: under 5e-5 in
    // Chromium and WebKit, 5.8e-5 at worst in Firefox.
    for (const t of [0, 0.025, 0.05, 0.1, 0.15, 0.2, 0.5, 0.95]) {
      expect(data[at(t)]!).toBeCloseTo(0.5 + 0.5 * Math.sin(2 * Math.PI * 5 * t), 3);
    }
    expect(maxOf(data.subarray(0, at(0.2)))).toBeCloseTo(1, 3);
    expect(minOf(data.subarray(0, at(0.2)))).toBeCloseTo(0, 3);
    // One cycle every 0.2 s: the 5 Hz component dominates the movement.
    const centred = data.map((v) => v - 0.5);
    expect(goertzel(centred, 5)).toBeCloseTo(0.5, 2);
    expect(goertzel(centred, 7)).toBeLessThan(0.01);
  });

  it("drives the next node's frequency by default", async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().lfo().lowpass({ id: 'f' }).to('main');
    expect(engine.select('#f').param('frequency').modulators.length).toBe(1);
  });

  it('modulate() connects it to a named parameter of a node elsewhere', async () => {
    const engine = await offlineEngine(1);
    engine.chain().gain({ id: 'x', gain: 0.5 }).to('main');
    constant(engine, 1).connect('#x');
    engine.chain().lfo({ frequency: 5, depth: 0.5 }).modulate('#x', 'gain');
    expect(engine.select('#x').param('gain').modulators.length).toBe(1);
    const data = samples(await engine.render());
    expect(data[at(0.05)]!).toBeCloseTo(1, 3);
    expect(data[at(0.15)]!).toBeCloseTo(0, 3);
  });

  it('makes the oscillator wobble when it modulates frequency', async () => {
    const engine = await offlineEngine(1);
    engine.chain().lfo({ frequency: 4, depth: 100 }).sine({ frequency: 1000 }).to('main');
    const data = samples(await engine.render());
    // A steady 1000 Hz sine reads 1.0 at 1000 Hz; vibrato of +-100 Hz spreads the energy to either side.
    expect(goertzel(data, 1000)).toBeLessThan(0.5);
  });

  it('has the shapes it advertises', async () => {
    const wave = async (shape: 'sine' | 'saw' | 'square' | 'triangle') => {
      const engine = await offlineEngine(0.2);
      engine.chain().lfo({ frequency: 5, shape }).to('main');
      const data = samples(await engine.render());
      return (t: number) => data[at(t) + 1]!;
    };
    // A 5 Hz wave has a period of 0.2 s.
    const sine = await wave('sine');
    expect(sine(0.05)).toBeCloseTo(1, 3);
    expect(sine(0.15)).toBeCloseTo(-1, 3);
    const triangle = await wave('triangle');
    expect(triangle(0.05)).toBeCloseTo(1, 3);
    expect(triangle(0.1)).toBeCloseTo(0, 2);
    expect(triangle(0.15)).toBeCloseTo(-1, 3);
    const square = await wave('square');
    // Measured 0.848 in Chromium at a quarter period, not 1: the browser's band-limited square ripples.
    expect(square(0.05)).toBeGreaterThan(0.8);
    expect(square(0.15)).toBeLessThan(-0.8);
    expect(square(0.07)).toBeCloseTo(square(0.03), 1);
    // The saw climbs from 0 to 1 over half a period, jumps to -1, and climbs back to 0.
    // (Measured in Chromium: 0.424 at a quarter period, 0.83 just before the jump: the browser band-limits the saw, so the ideal values 0.5 and 1 are not reached.)
    const saw = await wave('saw');
    expect(saw(0.05)).toBeGreaterThan(0.4);
    expect(saw(0.099)).toBeGreaterThan(0.7);
    expect(saw(0.101)).toBeLessThan(-0.7);
    expect(saw(0.15)).toBeLessThan(-0.4);
  });

  it('depth scales the swing', async () => {
    const engine = await offlineEngine(0.2);
    engine.chain().lfo({ frequency: 5, depth: 200 }).to('main');
    expect(maxOf(samples(await engine.render()))).toBeCloseTo(200, 1);
  });
});

describe('stepper', () => {
  async function render(init: Record<string, number>, seconds = 3, seed?: number) {
    const engine =
      seed === undefined ? await offlineEngine(seconds) : await seededEngine(seconds, seed);
    engine.chain().stepper(init).to('main');
    return samples(await engine.render());
  }

  it('holds a constant level within each step and changes between steps', async () => {
    const data = await render({ steps: 4, length: 1 });
    const levels: number[] = [];
    for (let step = 0; step < 4; step++) {
      const slice = data.subarray(step * 12000, (step + 1) * 12000);
      expect(slice.every((v) => v === slice[0])).toBe(true);
      levels.push(slice[0]!);
    }
    for (let i = 1; i < 4; i++) expect(levels[i]).not.toBe(levels[i - 1]);
    expect(levels.every((v) => v >= -1 && v <= 1)).toBe(true);
    // The change is at the exact sample.
    expect(data[11999]).not.toBe(data[12000]);
  });

  it('repeats every `length` seconds, exactly', async () => {
    const data = await render({ steps: 5, length: 0.5 }, 2);
    expect(identical(data.subarray(0, 24000), data.subarray(24000, 48000))).toBe(true);
    expect(identical(data.subarray(0, 24000), data.subarray(72000, 96000))).toBe(true);
  });

  it('defaults to 8 steps over 1 second', async () => {
    const data = await render({}, 1);
    const distinct = new Set(data);
    expect(distinct.size).toBe(8);
    expect(data[5999]).toBe(data[0]);
    expect(data[6000]).not.toBe(data[5999]);
  });

  it('is identical across renders with the same seed, and differs with another', async () => {
    const a = await render({ steps: 8 }, 1);
    const b = await render({ steps: 8 }, 1);
    expect(identical(a, b)).toBe(true);
    expect(identical(await render({}, 1, 1), await render({}, 1, 2))).toBe(false);
  });

  it('depth scales the levels', async () => {
    const one = await render({ steps: 4 }, 1);
    const engine = await offlineEngine(1);
    engine.chain().stepper({ steps: 4, depth: 100 }).to('main');
    const hundred = samples(await engine.render());
    expect(hundred[0]!).toBeCloseTo(one[0]! * 100, 3);
    expect(hundred[30000]!).toBeCloseTo(one[30000]! * 100, 3);
  });

  it("drives the next node's frequency by default", async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().stepper().lowpass({ id: 'f' }).to('main');
    expect(engine.select('#f').param('frequency').modulators.length).toBe(1);
  });
});

const maxOf = (data: Float32Array) => data.reduce((a, b) => Math.max(a, b), -Infinity);
const minOf = (data: Float32Array) => data.reduce((a, b) => Math.min(a, b), Infinity);
