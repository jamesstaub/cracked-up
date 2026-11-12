import { describe, expect, it } from 'vitest';
import { createEngine } from '../../src';
import type { Engine } from '../../src';
import { SAMPLE_RATE, makeBuffer } from '../core/setup';

async function engine(seconds: number): Promise<Engine> {
  const context = new OfflineAudioContext(1, Math.round(SAMPLE_RATE * seconds), SAMPLE_RATE);
  return createEngine({ context });
}

type WithCrusher = { bitcrusher(init?: object): { to(bus: string): unknown } };

/** A slow ramp from -1 to 1, so every quantisation level is visited. */
const ramp = (seconds: number) => makeBuffer(seconds, (_i, t) => -1 + (2 * t) / seconds);

async function crushed(init: object, seconds = 0.25): Promise<Float32Array> {
  const e = await engine(seconds);
  const chain = e.chain().sampler({ id: 'src', buffer: ramp(seconds) }) as unknown as WithCrusher;
  chain.bitcrusher({ id: 'crush', ...init }).to('main');
  e.select('#src').trigger({ at: 0 });
  return (await e.render()).getChannelData(0);
}

describe('bitcrusher', () => {
  it('reduces the signal to 2^bits levels', async () => {
    const levels = (data: Float32Array) =>
      new Set(Array.from(data, (v) => Math.round(v * 1e6))).size;
    // Levels are step * n for whole n, covering -1 to 1 inclusive: 2^bits + 1 values on a full-range ramp.
    expect(levels(await crushed({ bits: 1 }))).toBe(3);
    expect(levels(await crushed({ bits: 2 }))).toBe(5);
    expect(levels(await crushed({ bits: 4 }))).toBe(17);
  });

  it('at 16 bits and full rate it is close to the input', async () => {
    const data = await crushed({ bits: 16, rate: 1 });
    let worst = 0;
    for (let i = 0; i < data.length; i++) {
      worst = Math.max(worst, Math.abs(data[i]! - (-1 + (2 * i) / data.length)));
    }
    expect(worst).toBeLessThan(1 / 32768 + 1e-6);
  });

  it('holds each sample for 1 / rate samples', async () => {
    const data = await crushed({ bits: 16, rate: 0.25 });
    let changes = 0;
    for (let i = 1; i < 4000; i++) if (data[i] !== data[i - 1]) changes++;
    // One new value every four samples.
    expect(changes).toBeGreaterThanOrEqual(998);
    expect(changes).toBeLessThanOrEqual(1000);
    expect(data[1]).toBe(data[0]);
    expect(data[3]).toBe(data[0]);
    expect(data[4]).not.toBe(data[0]);
  });

  it('follows a scheduled change of bits', async () => {
    const e = await engine(0.5);
    const chain = e.chain().sampler({ id: 'src', buffer: ramp(0.5) }) as unknown as WithCrusher;
    chain.bitcrusher({ id: 'crush', bits: 16 }).to('main');
    e.select('#src').trigger({ at: 0 });
    e.select('#crush').set({ bits: 1 }, { at: 0.25 });
    const data = (await e.render()).getChannelData(0);
    const distinct = (from: number, to: number) =>
      new Set(Array.from(data.subarray(from, to), (v) => Math.round(v * 1e6))).size;
    expect(distinct(0, 11000)).toBeGreaterThan(1000);
    // After the change (allowing one 128-sample block for the parameter to take effect): at most 3 levels.
    expect(distinct(12128, 24000)).toBeLessThanOrEqual(3);
  });

  it('describes itself', async () => {
    const info = (await engine(0.01)).registry.describe('bitcrusher');
    expect(info.params.map((param) => param.name)).toEqual(['bits', 'rate']);
    expect(info.params.every((param) => param.description)).toBe(true);
  });
});
