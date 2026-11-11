import { describe, expect, it } from 'vitest';
import { CrackedUpError } from '../../src';
import { findOnsets } from '../helpers';
import { constant, offlineEngine, valueAt } from './setup';

describe('parameters', () => {
  it('applies a starting value given at creation', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2).gain(0.5).to('main');
    const audio = await engine.render();
    expect(valueAt(audio, 0.1)).toBeCloseTo(0.5, 6);
  });

  it('schedules a change at an exact sample and reports it as the base value', async () => {
    const engine = await offlineEngine(1);
    constant(engine, 1).gain({ id: 'level', gain: 0 }).to('main');
    const level = engine.select('#level');
    level.set({ gain: 1 }, { at: 0.5 });
    expect(level.param('gain').value).toBe(1);
    const audio = await engine.render();
    expect(findOnsets(audio, { threshold: 0.5, minGapSamples: 10 })).toEqual([24000]);
  });

  it('reads a base value of 0 as 0', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().gain({ id: 'level', gain: 0 }).to('main');
    expect(engine.select('#level').param('gain').value).toBe(0);
  });

  it('offsets sit on top of the base value and leave it unchanged', async () => {
    const engine = await offlineEngine(1);
    constant(engine, 1).gain({ id: 'level', gain: 0.25 }).to('main');
    const level = engine.select('#level');
    level.offset('gain', 0.5, { at: 0.25, duration: 0.25 });
    expect(level.param('gain').value).toBe(0.25);
    const audio = await engine.render();
    expect(valueAt(audio, 0.1)).toBeCloseTo(0.25, 6);
    expect(valueAt(audio, 0.3)).toBeCloseTo(0.75, 6);
    expect(valueAt(audio, 0.6)).toBeCloseTo(0.25, 6);
    // The offset starts and ends on exact samples.
    const data = audio.getChannelData(0);
    expect(data[11999]).toBeCloseTo(0.25, 6);
    expect(data[12000]).toBeCloseTo(0.75, 6);
    expect(data[23999]).toBeCloseTo(0.75, 6);
    expect(data[24000]).toBeCloseTo(0.25, 6);
  });

  it('a base change during an offset keeps the offset', async () => {
    const engine = await offlineEngine(1);
    constant(engine, 1).gain({ id: 'level', gain: 0.1 }).to('main');
    const level = engine.select('#level');
    level.offset('gain', 0.5, { at: 0.2, duration: 0.6 });
    level.set({ gain: 0.3 }, { at: 0.5 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.3)).toBeCloseTo(0.6, 6);
    expect(valueAt(audio, 0.6)).toBeCloseTo(0.8, 6);
    expect(valueAt(audio, 0.9)).toBeCloseTo(0.3, 6);
  });

  it('ramps linearly to the target, which becomes the base value', async () => {
    const engine = await offlineEngine(1);
    constant(engine, 1).gain({ id: 'level', gain: 0 }).to('main');
    const param = engine.select('#level').param('gain');
    param.ramp(1, { at: 0, duration: 0.5 });
    expect(param.value).toBe(1);
    const audio = await engine.render();
    expect(valueAt(audio, 0.25)).toBeCloseTo(0.5, 3);
    expect(valueAt(audio, 0.75)).toBeCloseTo(1, 6);
  });

  it('exponential ramps reach a target of zero without throwing', async () => {
    const engine = await offlineEngine(0.5);
    constant(engine, 0.5).gain({ id: 'level', gain: 1 }).to('main');
    engine.select('#level').ramp('gain', 0, { at: 0, duration: 0.25, curve: 'exp' });
    const audio = await engine.render();
    expect(valueAt(audio, 0.4)).toBeLessThan(0.001);
  });

  it('emits change with the time it takes effect, and only when the value differs', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().gain({ id: 'level', gain: 0.5 }).to('main');
    const param = engine.select('#level').param('gain');
    const seen: { value: unknown; previous: unknown; at: number }[] = [];
    param.on('change', ({ value, previous, at }) => seen.push({ value, previous, at }));
    param.set(0.5);
    param.set(0.8, { at: 0.05 });
    expect(seen).toEqual([{ value: 0.8, previous: 0.5, at: 0.05 }]);
  });

  it('maps a control position through the curve in both directions', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().lowpass({ id: 'filter' }).to('main');
    const frequency = engine.select('#filter').param('frequency');
    frequency.setNormalized(0.5);
    expect(frequency.value).toBeCloseTo(Math.sqrt(20 * 20000), 6);
    expect(frequency.normalized).toBeCloseTo(0.5, 9);
    expect(frequency.meta).toMatchObject({ unit: 'hz', curve: 'log', min: 20, max: 20000 });
  });

  it('does not clamp values to the control range', async () => {
    const engine = await offlineEngine(0.1);
    constant(engine, 0.1).gain({ id: 'depth', gain: 300 }).to('main');
    expect(engine.select('#depth').param('gain').value).toBe(300);
    const audio = await engine.render();
    expect(valueAt(audio, 0.05)).toBeCloseTo(300, 3);
  });

  it('rejects values of the wrong kind', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().sampler({ id: 's' }).gain({ id: 'level' }).to('main');
    const gain = engine.select('#level').param('gain');
    expect(() => gain.set(Number.NaN)).toThrowError(CrackedUpError);
    expect(() => engine.select('#s').param('loop').set('yes')).toThrowError(/true or false/);
    // speed is not an audio-rate parameter of the sampler node itself, so it cannot be ramped
    expect(() => engine.select('#s').param('speed').ramp(2, { duration: 1 })).toThrowError(
      /cannot be ramped/,
    );
    expect(() => engine.select('#level').param('cutoff')).toThrowError(
      /no parameter called "cutoff"/,
    );
  });

  it('generates a setter for each parameter name', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2).gain({ id: 'level' }).lowpass({ id: 'filter' }).to('main');
    engine.select('gain').gain(0.5);
    engine.select('#filter').frequency(800).q(4);
    expect(engine.select('#filter').param('frequency').value).toBe(800);
    expect(engine.select('#filter').param('q').value).toBe(4);
    const audio = await engine.render();
    expect(valueAt(audio, 0.15)).toBeCloseTo(0.5, 3);
  });

  it('records audio-rate modulation and adds it to the base value', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2, 'carrier').gain({ id: 'vca', gain: 0.25 }).to('main');
    constant(engine, 0.2, 'mod').gain(0.5).modulate('#vca', 'gain');
    const param = engine.select('#vca').param('gain');
    expect(param.modulators).toHaveLength(1);
    expect(param.value).toBe(0.25);
    const audio = await engine.render();
    expect(valueAt(audio, 0.1)).toBeCloseTo(0.75, 6);
  });
});
