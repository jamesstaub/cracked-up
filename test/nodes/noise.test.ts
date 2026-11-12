import { describe, expect, it } from 'vitest';
import { peak, rms } from '../helpers';
import { offlineEngine } from '../core/setup';
import { identical, samples, seededEngine } from './util';

type Color = 'white' | 'pink' | 'brown';

async function render(color: Color, highpass?: number, seconds = 1, seed?: number) {
  const engine =
    seed === undefined ? await offlineEngine(seconds) : await seededEngine(seconds, seed);
  const chain = engine.chain().noise({ color });
  (highpass === undefined ? chain : chain.highpass(highpass)).to('main');
  return engine.render();
}

describe('noise', () => {
  it('is audible, in a sane range, for every colour', async () => {
    // Measured rms over 1 s: white 0.2542 (peak 0.44), pink 0.2047 (peak 0.82), brown 0.2049 (peak 0.78).
    const expected: Record<Color, number> = { white: 0.2542, pink: 0.2047, brown: 0.2049 };
    for (const color of ['white', 'pink', 'brown'] as const) {
      const audio = await render(color);
      expect(rms(audio)).toBeCloseTo(expected[color], 2);
      expect(peak(audio)).toBeLessThan(1);
      expect(peak(audio)).toBeGreaterThan(0.4);
    }
  });

  it('defaults to white', async () => {
    const plain = await offlineEngine(0.1);
    plain.chain().noise().to('main');
    expect(samples(await plain.render())).toEqual(samples(await render('white', undefined, 0.1)));
  });

  it('has less high-frequency energy from white to pink to brown', async () => {
    // rms after a 5 kHz highpass. Measured: white 0.2511, pink 0.0963, brown 0.0365.
    const white = rms(await render('white', 5000));
    const pink = rms(await render('pink', 5000));
    const brown = rms(await render('brown', 5000));
    expect(white).toBeCloseTo(0.2511, 2);
    expect(pink).toBeLessThan(white * 0.45);
    expect(brown).toBeLessThan(pink * 0.45);
  });

  it('loops its two-second buffer seamlessly and exactly', async () => {
    const data = samples(await render('white', undefined, 4.5));
    expect(identical(data.subarray(0, 48000), data.subarray(96000, 144000))).toBe(true);
    expect(identical(data.subarray(0, 48000), data.subarray(48000, 96000))).toBe(false);
  });

  it('is identical across renders with the same seed, and differs with another', async () => {
    for (const color of ['white', 'pink', 'brown'] as const) {
      const a = samples(await render(color, undefined, 0.3));
      const b = samples(await render(color, undefined, 0.3));
      expect(identical(a, b)).toBe(true);
      const c = samples(await render(color, undefined, 0.3, 1));
      const d = samples(await render(color, undefined, 0.3, 2));
      expect(identical(c, d)).toBe(false);
    }
  });

  it('with the gate closed is silent until triggered, at an exact sample', async () => {
    const engine = await offlineEngine(1);
    engine.chain().noise({ id: 'n', gate: 'closed' }).to('main');
    engine.select('#n').trigger({ at: 0.5 });
    const audio = await engine.render();
    const data = audio.getChannelData(0);
    expect(data.findIndex((v) => v !== 0)).toBe(24000);
    expect(rms(audio, 0, 24000, 48000)).toBeGreaterThan(0.2);
  });

  it('honours duration, velocity and release', async () => {
    const engine = await offlineEngine(1);
    engine.chain().noise({ id: 'n', gate: 'closed' }).to('main');
    const n = engine.select('#n');
    n.trigger({ at: 0.1, duration: 0.1, velocity: 0.5 });
    n.trigger({ at: 0.5 });
    n.release({ at: 0.6 });
    const audio = await engine.render();
    const level = (from: number, to: number) => rms(audio, 0, from * 48000, to * 48000);
    expect(level(0, 0.1)).toBe(0);
    expect(level(0.1, 0.2)).toBeCloseTo(0.5 * 0.2542, 1);
    expect(level(0.2, 0.5)).toBe(0);
    expect(level(0.5, 0.6)).toBeGreaterThan(0.2);
    expect(level(0.6, 1)).toBe(0);
  });

  it('scales with gain', async () => {
    const engine = await offlineEngine(0.5);
    engine.chain().noise({ gain: 0.5 }).to('main');
    expect(rms(await engine.render())).toBeCloseTo(0.5 * 0.2542, 2);
  });
});
