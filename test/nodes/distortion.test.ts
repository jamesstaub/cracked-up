import { describe, expect, it } from 'vitest';
import { dominantFrequency, peak, rms } from '../helpers';
import { SAMPLE_RATE, makeBuffer, offlineEngine, ones } from '../core/setup';
import { goertzel, maxDiff, samples } from './util';

const sine = (hz: number, seconds = 0.5) =>
  makeBuffer(seconds, (_i, t) => Math.sin(2 * Math.PI * hz * t));

async function through(
  type: 'overdrive' | 'waveshaper',
  init: Record<string, number>,
  input: AudioBuffer,
  change?: { at: number; values: Record<string, number> },
) {
  const engine = await offlineEngine(input.duration);
  const source = engine.chain().sampler({ id: 'in', buffer: input });
  source[type]({ id: 'fx', ...init }).to('main');
  engine.select('#in').trigger({ at: 0 });
  if (change) engine.select('#fx').set(change.values, { at: change.at });
  return engine.render();
}

describe('overdrive', () => {
  it('keeps the pitch but changes the shape of a sine', async () => {
    const clean = await through('overdrive', { drive: 0 }, sine(800));
    const driven = await through('overdrive', { drive: 1 }, sine(800));
    expect(dominantFrequency(driven)).toBeCloseTo(800, -1);
    // A pure sine has rms / peak = 0.7071. Measured over the first 0.25 s (after the filters settle):
    // drive 0 -> 0.7075 (the curve is a straight line, so still a sine), drive 0.5 -> 0.743, drive 1 -> 0.730.
    const ratio = (audio: AudioBuffer) => rms(audio, 0, 2400, 12000) / peakOf(audio, 2400, 12000);
    expect(ratio(clean)).toBeCloseTo(0.7071, 2);
    expect(ratio(driven)).toBeGreaterThan(0.72);
    // Overtones appear: 3 x 800 Hz is above the sine's own content, so the driven signal has it.
    const tail = samples(driven).subarray(2400, 2400 + 24000);
    const cleanTail = samples(clean).subarray(2400, 2400 + 24000);
    expect(goertzel(tail, 2400)).toBeGreaterThan(0.01);
    expect(goertzel(cleanTail, 2400)).toBeLessThan(0.001);
  });

  it('stays bounded', async () => {
    // Measured peaks for a full-scale 800 Hz sine: 0.347 (drive 0), 0.454 (0.5), 0.473 (1). The curve
    // itself never exceeds 0.349; the rest is ringing in the lowpass after it.
    for (const drive of [0, 0.5, 1]) {
      const audio = await through('overdrive', { drive }, sine(800));
      expect(peak(audio)).toBeLessThan(0.5);
      expect(peak(audio)).toBeGreaterThan(0.3);
    }
  });

  it('a change to drive takes effect at the scheduled sample and not before', async () => {
    const input = sine(800, 0.5);
    const low = samples(await through('overdrive', { drive: 0 }, input));
    const high = samples(await through('overdrive', { drive: 1 }, input));
    const changed = samples(
      await through('overdrive', { drive: 0 }, input, { at: 0.25, values: { drive: 1 } }),
    );
    const at = 0.25 * SAMPLE_RATE;
    // Up to the change it is the same as drive 0 throughout; from the change it follows drive 1, apart
    // from the memory of the lowpass after the shaper, which has died away well before 100 samples.
    expect(maxDiff(changed, low, 0, at)).toBe(0);
    expect(maxDiff(changed, high, at + 100)).toBeLessThan(1e-6);
    expect(maxDiff(changed, low, at + 100, at + 2000)).toBeGreaterThan(0.01);
  });

  it('applies a drive given at creation, and reports it', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().overdrive({ id: 'od', drive: 0.8 });
    expect(engine.select('#od').param('drive').value).toBe(0.8);
    engine.chain().overdrive(0.2);
  });

  it('moves the colour and postCut filters', async () => {
    const dark = await through('overdrive', { drive: 1, postCut: 300 }, sine(800));
    const bright = await through('overdrive', { drive: 1, postCut: 8000 }, sine(800));
    const at = (audio: AudioBuffer) => goertzel(samples(audio).subarray(2400, 26400), 2400);
    expect(at(dark)).toBeLessThan(at(bright) / 3);
  });
});

describe('waveshaper', () => {
  it('flattens the peaks harder as drive rises', async () => {
    const input = sine(800);
    const ratio = async (drive: number) => {
      const audio = await through('waveshaper', { drive }, input);
      return rms(audio, 0, 2400, 12000) / peakOf(audio, 2400, 12000);
    };
    // Measured rms / peak: drive 0 -> 0.707 (a straight line), 50 -> 0.9225, 100 -> 0.942.
    expect(await ratio(0)).toBeCloseTo(0.7071, 2);
    expect(await ratio(50)).toBeGreaterThan(0.9);
    expect(await ratio(100)).toBeGreaterThan(await ratio(50));
  });

  it('keeps the pitch and stays bounded', async () => {
    // Measured peak for a full-scale sine: 0.3333 (drive 0), 0.350 (50), 0.3525 (100).
    for (const drive of [0, 50, 100]) {
      const audio = await through('waveshaper', { drive }, sine(800));
      expect(peak(audio)).toBeLessThan(0.36);
      expect(peak(audio)).toBeGreaterThan(0.33);
    }
    // The fundamental stays the strongest component (zero-crossing counting is thrown off by the ripple
    // the oversampling filter leaves on a nearly square wave, so this uses a single-bin DFT instead).
    const hard = samples(await through('waveshaper', { drive: 100 }, sine(800))).subarray(
      2400,
      26400,
    );
    expect(goertzel(hard, 800)).toBeGreaterThan(0.2);
    expect(goertzel(hard, 800)).toBeGreaterThan(goertzel(hard, 2400));
    expect(goertzel(hard, 800)).toBeGreaterThan(goertzel(hard, 1200) * 20);
  });

  it('uses 4x oversampling and changes drive at a scheduled sample', async () => {
    const input = sine(800, 0.5);
    const low = samples(await through('waveshaper', { drive: 0 }, input));
    const high = samples(await through('waveshaper', { drive: 100 }, input));
    const changed = samples(
      await through('waveshaper', { drive: 0 }, input, { at: 0.25, values: { drive: 100 } }),
    );
    const at = 0.25 * SAMPLE_RATE;
    expect(maxDiff(changed, low, 0, at - 64)).toBe(0);
    expect(maxDiff(changed, high, at + 64)).toBe(0);
  });

  it('takes drive as its shorthand', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().waveshaper({ id: 'ws' });
    expect(engine.select('#ws').param('drive').value).toBe(50);
    engine.chain().waveshaper(20);
  });
});

describe('ring', () => {
  it('turns a constant into a sine at the ring frequency', async () => {
    for (const frequency of [30, 100, 440]) {
      const engine = await offlineEngine(1);
      engine
        .chain()
        .sampler({ id: 'dc', buffer: ones(1) })
        .ring(frequency)
        .to('main');
      engine.select('#dc').trigger({ at: 0 });
      const audio = await engine.render();
      expect(Math.abs(dominantFrequency(audio) / frequency - 1)).toBeLessThan(0.01);
      // It is the sine itself: full amplitude, starting at 0.
      expect(peak(audio)).toBeCloseTo(1, 3);
      expect(audio.getChannelData(0)[0]).toBe(0);
    }
  });

  it('replaces each input frequency with the sum and the difference', async () => {
    const engine = await offlineEngine(1);
    engine
      .chain()
      .sampler({ id: 'in', buffer: sine(1000, 1) })
      .ring({ frequency: 100 })
      .to('main');
    engine.select('#in').trigger({ at: 0 });
    const data = samples(await engine.render());
    // sin(a) sin(b) = (cos(a - b) - cos(a + b)) / 2: two components of amplitude 0.5 and nothing at 1000.
    expect(goertzel(data, 900)).toBeCloseTo(0.5, 2);
    expect(goertzel(data, 1100)).toBeCloseTo(0.5, 2);
    expect(goertzel(data, 1000)).toBeLessThan(0.001);
  });

  it('mixes the original back in', async () => {
    const engine = await offlineEngine(1);
    engine
      .chain()
      .sampler({ id: 'in', buffer: sine(1000, 1) })
      .ring({ frequency: 100, mix: 0.5 })
      .to('main');
    engine.select('#in').trigger({ at: 0 });
    const data = samples(await engine.render());
    expect(goertzel(data, 1000)).toBeCloseTo(0.5, 2);
    expect(goertzel(data, 900)).toBeCloseTo(0.25, 2);
    expect(goertzel(data, 1100)).toBeCloseTo(0.25, 2);
  });
});

function peakOf(buffer: AudioBuffer, from: number, to: number): number {
  let max = 0;
  const data = buffer.getChannelData(0);
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(data[i] ?? 0));
  return max;
}
