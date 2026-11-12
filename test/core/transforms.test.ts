import { describe, expect, it } from 'vitest';
import type { Duration } from '../../src';
import { and, euclid, or, rotate, sieve, spread } from '../../src/util';
import { findOnsets } from '../helpers';
import { click, offlineEngine } from './setup';

// At 120 bpm and 48 kHz a sixteenth is 6000 samples.
describe('pattern helpers driving a sequence', () => {
  it('plays a combined pattern on exact samples and hands the callback its values', async () => {
    const engine = await offlineEngine(1);
    engine.chain().sampler({ id: 'hit', buffer: click() }).to('main');

    // A tresillo with a hit added on step 4, then accents kept only where a sieve allows.
    const rhythm = or(euclid(3, 8), rotate('x.......', -4));
    expect(rhythm).toEqual([1, 0, 0, 1, 1, 0, 1, 0]);
    const accents = and([3, 3, 3, 2, 2, 2, 5, 5], rhythm);
    const values: number[] = [];
    engine.transport.sequence({ steps: accents, step: '1/16' }, (ev) => {
      values.push(ev.value);
      if (ev.value) engine.select('#hit').trigger();
    });
    engine.transport.start();

    const onsets = findOnsets(await engine.render(), { threshold: 0.5, minGapSamples: 2 });
    expect(onsets).toEqual([0, 18000, 24000, 36000]);
    expect(values.slice(0, 8)).toEqual([3, 0, 0, 2, 2, 0, 5, 0]);
  });

  it('spread at twice the rate sounds the same as the original', async () => {
    const render = async (steps: number[], step: Duration): Promise<number[]> => {
      const engine = await offlineEngine(1);
      engine.chain().sampler({ id: 'hit', buffer: click() }).to('main');
      engine.transport.sequence({ steps, step }, (ev) => {
        if (ev.value) engine.select('#hit').trigger();
      });
      engine.transport.start();
      return findOnsets(await engine.render(), { threshold: 0.5, minGapSamples: 2 });
    };
    const pattern = sieve(8, [3, 0], [4, 2]);
    const plain = await render(pattern, '1/8');
    expect(plain).toEqual([0, 24000, 36000]);
    expect(await render(spread(pattern, 2), '1/16')).toEqual(plain);
  });
});
