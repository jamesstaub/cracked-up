import { describe, expect, it } from 'vitest';
import type { Engine, NodeInit } from '../../src';
import { SAMPLE_RATE, makeBuffer, offlineEngine } from './setup';

/** One second whose every sample holds its own time, so a render says where in the sound it was. */
const ramp = () => makeBuffer(1, (_i, t) => t);
const at = (seconds: number) => Math.round(seconds * SAMPLE_RATE);
const SAMPLE = 1 / SAMPLE_RATE;

async function render(
  init: NodeInit<'sampler'>,
  play: (engine: Engine) => void,
  seconds = 1,
): Promise<{ audio: Float32Array; said: (time: number) => number | undefined }> {
  const engine = await offlineEngine(seconds);
  engine.buffers.add('ramp', ramp()).slices = [0, 0.5, 1];
  engine
    .chain()
    .sampler({ id: 's', buffer: 'ramp', ...init })
    .to('main');
  play(engine);
  const node = engine.select('#s').first()!;
  const positions = new Map<number, number | undefined>();
  for (let step = 0; step < seconds * 200; step++) {
    positions.set(step, node.playheads(step / 200)[0]);
  }
  const audio = (await engine.render()).getChannelData(0).slice();
  return { audio, said: (time) => positions.get(Math.round(time * 200)) };
}

describe('sampler loop points', () => {
  it('by default loop repeats the whole region, sample for sample as loop points at its ends do', async () => {
    const play = (engine: Engine) => {
      engine.select('#s').trigger({ at: 0 }).release({ at: 0.9 });
    };
    for (const reverse of [false, true]) {
      const region = { start: 0.2, end: 0.35, loop: true, reverse };
      const plain = await render(region, play);
      const explicit = await render({ ...region, loopStart: 0.2, loopEnd: 0.35 }, play);
      const beyond = await render({ ...region, loopStart: 0, loopEnd: 60 }, play);
      const backwards = await render({ ...region, loopStart: 0.3, loopEnd: 0.25 }, play);
      expect(explicit.audio).toEqual(plain.audio);
      expect(beyond.audio).toEqual(plain.audio);
      expect(backwards.audio).toEqual(plain.audio);
      // Round the region more than four times, then silence.
      expect(plain.audio[at(0.7)]).toBeCloseTo(reverse ? 0.25 - SAMPLE : 0.3, 6);
      expect(plain.audio[at(0.95)]).toBe(0);
    }
  });

  it('plays from start, then goes round between the loop points until released, then stops', async () => {
    const { audio, said } = await render(
      { start: 0.1, end: 0.9, loop: true, loopStart: 0.3, loopEnd: 0.4 },
      (engine) => engine.select('#s').trigger({ at: 0 }).release({ at: 0.8 }),
    );
    // In from the start of the region ...
    expect(audio[at(0)]).toBeCloseTo(0.1, 6);
    expect(audio[at(0.25)]).toBeCloseTo(0.35, 6);
    expect(audio[at(0.3) - 1]).toBeCloseTo(0.4 - SAMPLE, 6);
    // ... back to the loop start on the sample the loop end is reached, and round again ...
    expect(audio[at(0.3)]).toBeCloseTo(0.3, 6);
    expect(audio[at(0.35)]).toBeCloseTo(0.35, 6);
    expect(audio[at(0.4)]).toBeCloseTo(0.3, 6);
    expect(audio[at(0.775)]).toBeCloseTo(0.375, 6);
    // ... and it never plays on to the end of the region: release stops it.
    expect(audio[at(0.8)]).toBe(0);
    expect(Math.max(...audio)).toBeLessThan(0.4);
    for (const time of [0, 0.25, 0.35, 0.775]) {
      expect(said(time)).toBeCloseTo(audio[at(time)]!, 5);
    }
    expect(said(0.8)).toBeUndefined();
  });

  it('reversed, plays down from end and goes round between the same two points', async () => {
    const { audio, said } = await render(
      { start: 0.1, end: 0.9, loop: true, loopStart: 0.3, loopEnd: 0.4, reverse: true },
      (engine) => engine.select('#s').trigger({ at: 0 }),
    );
    expect(audio[at(0)]).toBeCloseTo(0.9 - SAMPLE, 6);
    expect(audio[at(0.55)]).toBeCloseTo(0.35 - SAMPLE, 6);
    // Reaches the loop start 0.6 s in, and jumps up to the loop end.
    expect(audio[at(0.6) - 1]).toBeCloseTo(0.3, 6);
    expect(audio[at(0.6)]).toBeCloseTo(0.4 - SAMPLE, 6);
    expect(audio[at(0.675)]).toBeCloseTo(0.325 - SAMPLE, 6);
    expect(audio[at(0.975)]).toBeCloseTo(0.325 - SAMPLE, 6);
    expect(Math.min(...audio)).toBeGreaterThan(0.3 - SAMPLE);
    for (const time of [0, 0.55, 0.675, 0.975]) {
      expect(said(time)! - SAMPLE).toBeCloseTo(audio[at(time)]!, 5);
    }
  });

  it('with a slice, the loop points count where they are inside it', async () => {
    const points = { loop: true, loopStart: 0.6, loopEnd: 0.7 };
    const inside = await render(points, (engine) =>
      engine.select('#s').trigger({ at: 0, slice: 1 }),
    );
    expect(inside.audio[at(0)]).toBeCloseTo(0.5, 6);
    expect(inside.audio[at(0.15)]).toBeCloseTo(0.65, 6);
    expect(inside.audio[at(0.25)]).toBeCloseTo(0.65, 6);
    expect(inside.audio[at(0.95)]).toBeCloseTo(0.65, 6);
    expect(inside.said(0.95)).toBeCloseTo(0.65, 5);

    // A loop that straddles the slice's edge is cut to the slice: 0.4 to 0.5 of slice 0.
    const straddling = await render({ loop: true, loopStart: 0.4, loopEnd: 0.7 }, (engine) =>
      engine.select('#s').trigger({ at: 0, slice: 0 }),
    );
    expect(straddling.audio[at(0.45)]).toBeCloseTo(0.45, 6);
    expect(straddling.audio[at(0.55)]).toBeCloseTo(0.45, 6);

    // Loop points that miss the slice altogether: the whole slice repeats.
    const outside = await render(points, (engine) =>
      engine.select('#s').trigger({ at: 0, slice: 0 }),
    );
    expect(outside.audio[at(0.25)]).toBeCloseTo(0.25, 6);
    expect(outside.audio[at(0.75)]).toBeCloseTo(0.25, 6);
  });

  it('does nothing without loop, and can be given for one trigger', async () => {
    const points = { start: 0.1, end: 0.5, loopStart: 0.2, loopEnd: 0.3 };
    const play = (engine: Engine) => {
      engine.select('#s').trigger({ at: 0 });
    };
    const off = await render(points, play);
    const none = await render({ start: 0.1, end: 0.5 }, play);
    expect(off.audio).toEqual(none.audio);
    expect(off.audio[at(0.45)]).toBe(0);

    const once = await render({ start: 0.1, end: 0.5 }, (engine) =>
      engine.select('#s').trigger({ at: 0, loop: true, loopStart: 0.2, loopEnd: 0.3 }),
    );
    expect(once.audio[at(0.45)]).toBeCloseTo(0.25, 6);
    expect(once.audio[at(0.95)]).toBeCloseTo(0.25, 6);
  });

  it('follows speed round the loop', async () => {
    const { audio, said } = await render(
      { loop: true, loopStart: 0.25, loopEnd: 0.5, speed: 0.5 },
      (engine) => engine.select('#s').trigger({ at: 0 }),
    );
    // 0.5 s to reach the loop end at half speed, then 0.5 s per turn.
    expect(said(0.25)).toBeCloseTo(0.125, 9);
    expect(said(0.75)).toBeCloseTo(0.375, 9);
    expect(Math.abs(audio[at(0.75)]! - 0.375)).toBeLessThan(0.002);
  });

  it('declares its loop points as parameters with a range in seconds', async () => {
    const engine = await offlineEngine(0.1);
    const info = engine.registry.describe('sampler');
    for (const name of ['loopStart', 'loopEnd']) {
      expect(info.params.find((param) => param.name === name)).toMatchObject({
        kind: 'number',
        default: 0,
        min: 0,
        max: 60,
        unit: 'seconds',
        rate: 'control',
      });
    }
  });
});
