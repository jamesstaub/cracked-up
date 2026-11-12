import { describe, expect, it } from 'vitest';
import { findOnsets, peak, rms } from '../helpers';
import { click, makeBuffer, offlineEngine } from '../core/setup';
import { samples } from './util';

const T = 12000; // 0.25 s at 48 kHz

/** A click at 0 through a delay-like node, rendered. */
async function echoes(type: 'delay' | 'comb', init: Record<string, number>, seconds = 1.2) {
  const engine = await offlineEngine(seconds);
  engine.chain().sampler({ id: 'in', buffer: click() })[type](init).to('main');
  engine.select('#in').trigger({ at: 0 });
  return engine.render();
}

describe('delay', () => {
  it('repeats a click every `time`, each echo quieter than the last', async () => {
    const audio = await echoes('delay', { time: 0.25, feedback: 0.5, mix: 1 });
    const data = audio.getChannelData(0);
    const onsets = findOnsets(audio, { threshold: 0.05, minGapSamples: 1000 });
    expect(onsets.length).toBe(4);
    // The first echo goes straight through the delay: exact to the sample, at full level.
    expect(onsets[0]).toBe(T);
    expect(data[T]).toBe(1);
    // Browsers differ on a feedback loop. Chromium and WebKit add one 128-sample render quantum per
    // trip round the loop; Firefox adds none. Either way the spacing is regular.
    for (const k of [1, 2, 3]) {
      const late = onsets[k]! - (k + 1) * T;
      // The cutoff filter's own delay can move the threshold crossing by one sample.
      expect(Math.min(Math.abs(late), Math.abs(late - 128 * k))).toBeLessThanOrEqual(1);
    }
    // At 20 kHz the cutoff filter is not transparent (the sample rate is 48 kHz): measured peaks of
    // the repeats are 0.3447 and 0.1711 rather than 0.5 and 0.25, the same in all three browsers.
    const peakNear = (centre: number) => {
      let max = 0;
      for (let i = centre - 5; i < centre + 400; i++) max = Math.max(max, Math.abs(data[i]!));
      return max;
    };
    expect(peakNear(onsets[1]!)).toBeCloseTo(0.3447, 3);
    expect(peakNear(onsets[2]!)).toBeCloseTo(0.1711, 3);
  });

  it('gives each echo the feedback fraction of the one before when the cutoff is not in the way', async () => {
    // A slow-moving signal passes a 20 kHz lowpass almost unchanged, so levels are the ideal ones.
    const engine = await offlineEngine(1.2);
    const wave = makeBuffer(0.1, (i) => (i < 2400 ? Math.sin((Math.PI * i) / 2400) : 0)); // one 50 ms hump
    engine
      .chain()
      .sampler({ id: 'in', buffer: wave })
      .delay({ time: 0.25, feedback: 0.5, mix: 1 })
      .to('main');
    engine.select('#in').trigger({ at: 0 });
    const data = (await engine.render()).getChannelData(0);
    const hump = (from: number) => Math.max(...data.subarray(from, from + 2600).map(Math.abs));
    expect(hump(T)).toBeCloseTo(1, 3);
    expect(hump(2 * T)).toBeCloseTo(0.5, 2);
    expect(hump(3 * T)).toBeCloseTo(0.25, 2);
  });

  it('with mix 0 outputs the input unchanged', async () => {
    const audio = await echoes('delay', { time: 0.25, feedback: 0.5, mix: 0 });
    const expected = new Float32Array(audio.length);
    expected[0] = 1;
    expect(samples(audio)).toEqual(expected);
  });

  it('with mix 0.5 passes the dry click at half level and the echo at half level', async () => {
    const audio = await echoes('delay', { time: 0.25, feedback: 0, mix: 0.5 });
    const data = audio.getChannelData(0);
    expect(data[0]).toBe(0.5);
    expect(data[T]).toBe(0.5);
    expect(findOnsets(audio, { threshold: 0.05, minGapSamples: 100 })).toEqual([0, T]);
  });

  it('can change mix at a scheduled sample', async () => {
    const engine = await offlineEngine(1);
    engine
      .chain()
      .sampler({ id: 'in', buffer: click() })
      .delay({ id: 'd', time: 0.25, feedback: 0, mix: 0 })
      .to('main');
    engine.select('#in').trigger({ at: 0 });
    engine.select('#in').trigger({ at: 0.5 });
    engine.select('#d').set({ mix: 1 }, { at: 0.4 });
    const data = (await engine.render()).getChannelData(0);
    expect(data[0]).toBe(1); // dry before the change
    expect(data[T]).toBe(0); // the first click's echo is not heard: wet was 0 when it passed
    expect(data[24000]).toBe(0); // dry is gone after the change
    expect(data[36000]).toBe(1); // the second click's echo
  });

  it('a lower cutoff makes the repeats duller', async () => {
    const bright = await echoes('delay', { time: 0.1, feedback: 0.7, mix: 1, cutoff: 20000 }, 0.6);
    const dull = await echoes('delay', { time: 0.1, feedback: 0.7, mix: 1, cutoff: 500 }, 0.6);
    // Energy of the later repeats: the lowpass spreads and weakens the click each pass.
    expect(peak(dull)).toBeLessThanOrEqual(peak(bright));
    expect(rms(dull, 0, 14400)).toBeLessThan(rms(bright, 0, 14400) * 0.6);
  });

  it('accepts the time as a shorthand', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().delay(0.5).to('main');
    expect(engine.root.describe().nodes[0]?.params).toMatchObject({ time: 0.5 });
  });
});

describe('comb', () => {
  it('has its own defaults', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().comb({ id: 'c' });
    const comb = engine.select('#c');
    expect(comb.param('time').value).toBe(0.027);
    expect(comb.param('feedback').value).toBe(0.84);
    expect(comb.param('cutoff').value).toBe(3000);
    expect(comb.param('mix').value).toBe(1);
  });

  it('rings at about 1 / time and decays', async () => {
    const audio = await echoes('comb', { time: 0.01, feedback: 0.9, cutoff: 20000 }, 1);
    const data = audio.getChannelData(0);
    // The first repeats come at multiples of 10 ms (480 samples) plus one render quantum per trip round the loop on
    // Chromium and WebKit: the onsets are regular and fade.
    const onsets = findOnsets(audio, { threshold: 0.05, minGapSamples: 100 });
    expect(onsets[0]).toBe(480);
    expect(onsets.length).toBeGreaterThan(5);
    expect(rms(audio, 0, 24000, 48000)).toBeLessThan(rms(audio, 0, 0, 24000));
    expect(Math.abs(data[0]!)).toBe(0); // mix 1 by default: no dry click
  });
});
