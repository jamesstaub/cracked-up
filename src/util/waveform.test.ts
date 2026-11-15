import { describe, expect, it } from 'vitest';
import { createRandom } from './random';
import { createWaveformCache, waveformPeaks } from './waveform';
import type { AudioData } from './waveform';

function noise(seconds: number, channels: number, sampleRate = 48000, seed = 1): AudioData {
  const random = createRandom(seed);
  const length = Math.round(seconds * sampleRate);
  return {
    sampleRate,
    channels: Array.from({ length: channels }, () => {
      const data = new Float32Array(length);
      for (let i = 0; i < length; i++) data[i] = random.float() * 2 - 1;
      return data;
    }),
  };
}

describe('waveformPeaks', () => {
  it('gives the lowest and highest sample of each bucket', () => {
    const audio = {
      sampleRate: 8,
      channels: [new Float32Array([0, 1, -1, 0.5, 0.25, -0.5, 0, 0])],
    };
    const peaks = waveformPeaks(audio, { buckets: 4 });
    expect([...peaks.min]).toEqual([0, -1, -0.5, 0]);
    expect([...peaks.max]).toEqual([1, 0.5, 0.25, 0]);
    expect(peaks.rms).toBeUndefined();
    expect(peaks.start).toBe(0);
    expect(peaks.end).toBe(1);
  });

  it('covers only the range asked for, in seconds', () => {
    const audio = {
      sampleRate: 8,
      channels: [new Float32Array([0, 1, -1, 0.5, 0.25, -0.5, 0, 0])],
    };
    const peaks = waveformPeaks(audio, { buckets: 2, start: 0.25, end: 0.75 });
    expect([...peaks.min]).toEqual([-1, -0.5]);
    expect([...peaks.max]).toEqual([0.5, 0.25]);
  });

  it('mixes the channels by default and reads one when asked', () => {
    const audio = {
      sampleRate: 4,
      channels: [new Float32Array([1, 1, -1, 0]), new Float32Array([0, -1, -1, 0.5])],
    };
    const mix = waveformPeaks(audio, { buckets: 2 });
    expect([...mix.min]).toEqual([0, -1]);
    expect([...mix.max]).toEqual([0.5, 0.25]);
    const right = waveformPeaks(audio, { buckets: 2, channel: 1 });
    expect([...right.min]).toEqual([-1, -1]);
    expect([...right.max]).toEqual([0, 0.5]);
    expect(() => waveformPeaks(audio, { buckets: 2, channel: 2 })).toThrow(RangeError);
  });

  it('gives the RMS of each bucket when asked', () => {
    const audio = { sampleRate: 4, channels: [new Float32Array([1, -1, 0.5, 0])] };
    const peaks = waveformPeaks(audio, { buckets: 2, rms: true });
    expect(peaks.rms?.[0]).toBeCloseTo(1, 6);
    expect(peaks.rms?.[1]).toBeCloseTo(Math.sqrt(0.125), 6);
  });

  it('gives silence outside the sound and repeats samples when zoomed in past one per bucket', () => {
    const audio = { sampleRate: 4, channels: [new Float32Array([0.5, -0.5, 0.25, 1])] };
    const beyond = waveformPeaks(audio, { buckets: 4, start: 0.5, end: 1.5 });
    expect([...beyond.max]).toEqual([0.25, 1, 0, 0]);
    const close = waveformPeaks(audio, { buckets: 4, start: 0, end: 0.5 });
    expect([...close.max]).toEqual([0.5, 0.5, -0.5, -0.5]);
    expect(waveformPeaks(audio, { buckets: 0 }).min).toHaveLength(0);
    expect([...waveformPeaks(audio, { buckets: 2, start: 1, end: 0 }).max]).toEqual([0, 0]);
  });

  it('reads an AudioBuffer', () => {
    const buffer = new AudioBuffer({ length: 4, numberOfChannels: 1, sampleRate: 48000 });
    buffer.copyToChannel(new Float32Array([0.5, -0.5, 0.25, 1]), 0);
    expect([...waveformPeaks(buffer, { buckets: 2 }).max]).toEqual([0.5, 1]);
  });
});

describe('createWaveformCache', () => {
  it('gives exactly what waveformPeaks gives, at any zoom, range and channel', () => {
    const audio = noise(1.37, 2, 8000);
    const cache = createWaveformCache(audio, { blockSize: 16 });
    const random = createRandom(7);
    for (let round = 0; round < 60; round++) {
      const start = random.float() * 1.5 - 0.1;
      const end = start + random.float() * 1.5;
      const options = {
        buckets: random.int(1, 500),
        start,
        end,
        channel: random.pick(['mix', 0, 1] as const) ?? 'mix',
        rms: true,
      };
      const plain = waveformPeaks(audio, options);
      const cached = cache.peaks(options);
      expect(cached.min).toEqual(plain.min);
      expect(cached.max).toEqual(plain.max);
      for (let i = 0; i < options.buckets; i++) {
        expect(Math.abs(cached.rms![i]! - plain.rms![i]!)).toBeLessThan(1e-6);
      }
    }
    const whole = { buckets: 3, rms: true };
    expect(cache.peaks(whole).max).toEqual(waveformPeaks(audio, whole).max);
  });

  it('is fast enough to redraw a five-minute stereo sound on every zoom step', () => {
    const audio = noise(300, 2);
    const time = (run: () => void): number => {
      const before = performance.now();
      run();
      return performance.now() - before;
    };
    const whole = { buckets: 1000, rms: true };
    const zoomed = { buckets: 1000, start: 100, end: 110, rms: true };
    const plainWhole = time(() => waveformPeaks(audio, whole));
    const plainZoomed = time(() => waveformPeaks(audio, zoomed));
    const cache = createWaveformCache(audio);
    const first = time(() => cache.peaks(whole));
    let cachedWhole = Infinity;
    let cachedZoomed = Infinity;
    for (let i = 0; i < 5; i++) {
      cachedWhole = Math.min(
        cachedWhole,
        time(() => cache.peaks(whole)),
      );
      cachedZoomed = Math.min(
        cachedZoomed,
        time(() => cache.peaks(zoomed)),
      );
    }
    console.log(
      `waveform timings, 5 min stereo at 48 kHz, 1000 buckets, mix with RMS: ` +
        `plain whole ${plainWhole.toFixed(1)} ms, plain 10 s range ${plainZoomed.toFixed(1)} ms, ` +
        `cache first call ${first.toFixed(1)} ms, cached whole ${cachedWhole.toFixed(2)} ms, ` +
        `cached 10 s range ${cachedZoomed.toFixed(2)} ms`,
    );
    expect(cache.peaks(whole).max).toEqual(waveformPeaks(audio, whole).max);
    // Generous: it measures about 1 ms, and test machines vary.
    expect(cachedWhole).toBeLessThan(50);
    expect(cachedZoomed).toBeLessThan(50);
  });
});
