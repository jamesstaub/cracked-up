import { describe, expect, it } from 'vitest';
import { dominantFrequency, findOnsets, renderOffline, rms } from './helpers';

describe('offline render harness', () => {
  it('an empty graph renders silence', async () => {
    const b = await renderOffline({ seconds: 0.1 }, () => {});
    expect(rms(b, 0)).toBe(0);
    expect(rms(b, 1)).toBe(0);
  });

  it('a 440 Hz oscillator has dominant frequency within 1% of 440', async () => {
    const b = await renderOffline({ seconds: 1 }, (ctx) => {
      const o = new OscillatorNode(ctx, { frequency: 440 });
      o.connect(ctx.destination);
      o.start();
    });
    const f = dominantFrequency(b);
    expect(Math.abs(f - 440) / 440).toBeLessThan(0.01);
  });

  it('two clicks at 0.25 s and 0.5 s are found at samples 12000 and 24000', async () => {
    const b = await renderOffline({ seconds: 1 }, (ctx) => {
      for (const t of [0.25, 0.5]) {
        const s = new ConstantSourceNode(ctx, { offset: 1 });
        s.connect(ctx.destination);
        s.start(t);
        s.stop(t + 0.01);
      }
    });
    const onsets = findOnsets(b, { threshold: 0.5, minGapSamples: 480, channel: 0 });
    expect(onsets).toHaveLength(2);
    expect(Math.abs((onsets[0] ?? NaN) - 12000)).toBeLessThanOrEqual(1);
    expect(Math.abs((onsets[1] ?? NaN) - 24000)).toBeLessThanOrEqual(1);
  });
});
