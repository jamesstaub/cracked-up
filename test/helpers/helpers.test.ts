import { describe, expect, it } from 'vitest';
import { dominantFrequency, findOnsets, peak, renderOffline, rms } from './index';

function bufferFrom(samples: number[], sampleRate = 48000): AudioBuffer {
  const b = new AudioBuffer({ length: samples.length, sampleRate, numberOfChannels: 1 });
  b.copyToChannel(new Float32Array(samples), 0);
  return b;
}

describe('renderOffline', () => {
  it('honours seconds, sampleRate and channels', async () => {
    const b = await renderOffline({ seconds: 0.5, sampleRate: 44100, channels: 1 }, () => {});
    expect(b.length).toBe(22050);
    expect(b.sampleRate).toBe(44100);
    expect(b.numberOfChannels).toBe(1);
  });
  it('awaits an async build function', async () => {
    const b = await renderOffline({ seconds: 0.01 }, async (ctx) => {
      await Promise.resolve();
      const s = new ConstantSourceNode(ctx, { offset: 0.5 });
      s.connect(ctx.destination);
      s.start();
    });
    expect(peak(b)).toBeCloseTo(0.5);
  });
});

describe('analysis', () => {
  it('rms and peak', () => {
    const b = bufferFrom([1, -1, 1, -1]);
    expect(rms(b)).toBeCloseTo(1);
    expect(rms(bufferFrom([0, 0, 1, 1]), 0, 2)).toBeCloseTo(1);
    expect(rms(bufferFrom([0, 0, 1, 1]), 0, 0, 2)).toBe(0);
    expect(peak(bufferFrom([0.2, -0.7, 0.3]))).toBeCloseTo(0.7);
  });
  it('findOnsets respects minGapSamples', () => {
    const b = bufferFrom([0, 1, 1, 0, 1, 0, 0, 0, 0, 1]);
    expect(findOnsets(b, { threshold: 0.5, minGapSamples: 2 })).toEqual([1, 9]);
    expect(findOnsets(b, { threshold: 0.5, minGapSamples: 1 })).toEqual([1, 4, 9]);
  });
  it('dominantFrequency of a synthesized sine', () => {
    const n = 48000;
    const s = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000));
    expect(dominantFrequency(bufferFrom(s))).toBeCloseTo(1000, 0);
  });
});
