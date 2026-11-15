import { describe, expect, it } from 'vitest';
import type { Engine } from '../../src';
import { SAMPLE_RATE, makeBuffer, offlineEngine } from './setup';

/** One second whose every sample holds its own time, so a render says where in the sound it was. */
const ramp = () => makeBuffer(1, (_i, t) => t);

/** A tenth of a sample, in seconds. */
const EXACT = 0.1 / SAMPLE_RATE;

/**
 * Firefox plays a sound at any speed but 1 through a resampling filter: the audio rings for a
 * moment where a voice starts, ends or changes speed, and its level is a fraction of a percent
 * out. There a render confirms a position only to within 2 ms, and not at those moments.
 */
const FILTERED = navigator.userAgent.includes('Firefox');

/**
 * Asks for the play positions at each time before rendering, then renders and checks each against
 * the audio: the rendered sample at that time is the place in the sound that was playing.
 */
async function check(
  engine: Engine,
  times: readonly number[],
  { reverse = false, edges = [] as readonly number[] } = {},
): Promise<(number | undefined)[]> {
  const node = engine.select('#s').first()!;
  const said = times.map((time) => node.playheads(time).slice());
  const audio = (await engine.render()).getChannelData(0);
  const wrong: string[] = [];
  const tolerance = FILTERED && edges.length > 0 ? 0.002 : EXACT;
  times.forEach((time, index) => {
    const heard = audio[Math.round(time * SAMPLE_RATE)]!;
    const positions = said[index]!;
    if (FILTERED && edges.includes(time)) return;
    if (positions.length === 0) {
      if (heard !== 0) wrong.push(`silent at ${time} but heard ${heard}`);
    } else {
      expect(positions, `one voice at ${time}`).toHaveLength(1);
      // Backwards, the sample heard is the one that ends at the position.
      const expected = reverse ? positions[0]! - 1 / SAMPLE_RATE : positions[0]!;
      if (!(Math.abs(heard - expected) < tolerance)) {
        wrong.push(`at ${time}: said ${expected}, heard ${heard}`);
      }
    }
  });
  expect(wrong).toEqual([]);
  return said.map((positions) => positions[0]);
}

describe('sampler play position', () => {
  it('is where the rendered audio is, forwards, and nothing before the start or after the end', async () => {
    const engine = await offlineEngine(1);
    engine.chain().sampler({ id: 's', buffer: ramp(), start: 0.2, end: 0.6 }).to('main');
    engine.select('#s').trigger({ at: 0.1 });
    const said = await check(engine, [0, 0.05, 0.1, 0.25, 0.4, 0.49, 0.5, 0.75]);
    expect(said[0]).toBeUndefined();
    expect(said[1]).toBeUndefined();
    expect(said[2]).toBeCloseTo(0.2, 9);
    expect(said[3]).toBeCloseTo(0.35, 9);
    expect(said[5]).toBeCloseTo(0.59, 9);
    expect(said[6]).toBeUndefined();
    expect(said[7]).toBeUndefined();
  });

  it('follows speed, as a base value and for one trigger', async () => {
    const fast = await offlineEngine(1);
    fast.chain().sampler({ id: 's', buffer: ramp(), speed: 2 }).to('main');
    fast.select('#s').trigger({ at: 0.1 });
    const double = await check(fast, [0.1, 0.2, 0.35, 0.59, 0.6, 0.7], { edges: [0.1, 0.6] });
    expect(double[1]).toBeCloseTo(0.2, 9);
    expect(double[3]).toBeCloseTo(0.98, 9);
    expect(double[4]).toBeUndefined();

    const slow = await offlineEngine(1);
    slow.chain().sampler({ id: 's', buffer: ramp() }).to('main');
    slow.select('#s').trigger({ at: 0, speed: 0.5 });
    const half = await check(slow, [0.1, 0.5, 0.9], { edges: [0] });
    expect(half[2]).toBeCloseTo(0.45, 9);
  });

  it('follows speed changes made while the voice plays', async () => {
    const engine = await offlineEngine(1);
    engine.chain().sampler({ id: 's', buffer: ramp() }).to('main');
    const s = engine.select('#s');
    s.trigger({ at: 0 });
    s.set({ speed: 2 }, { at: 0.2 });
    s.set({ speed: 0.25 }, { at: 0.4 });
    s.param('speed').offset(0.75, { at: 0.6, duration: 0.1 });
    const said = await check(engine, [0.1, 0.2, 0.21, 0.3, 0.4, 0.41, 0.5, 0.65, 0.8, 0.95], {
      edges: [0.2, 0.4],
    });
    expect(said[0]).toBeCloseTo(0.1, 9);
    // About 0.2 + 2 * 0.1; the change lands on the next block of 128 frames.
    expect(said[3]).toBeCloseTo(0.4, 2);
    expect(said[6]).toBeCloseTo(0.625, 2);
  });

  it('a speed set before a scheduled voice starts is the speed it starts with', async () => {
    const engine = await offlineEngine(1);
    engine.chain().sampler({ id: 's', buffer: ramp() }).to('main');
    const s = engine.select('#s');
    s.trigger({ at: 0.3 });
    s.set({ speed: 2 }, { at: 0.1 });
    const said = await check(engine, [0.2, 0.3, 0.5, 0.7], { edges: [0.3] });
    expect(said[2]).toBeCloseTo(0.4, 9);
  });

  it('runs backwards from the end of the region when reversed', async () => {
    const engine = await offlineEngine(1);
    engine
      .chain()
      .sampler({ id: 's', buffer: ramp(), start: 0.2, end: 0.6, reverse: true })
      .to('main');
    engine.select('#s').trigger({ at: 0.1, speed: 0.5 });
    const said = await check(engine, [0.1, 0.3, 0.5, 0.89, 0.95], {
      reverse: true,
      edges: [0.1],
    });
    expect(said[0]).toBeCloseTo(0.6, 9);
    expect(said[1]).toBeCloseTo(0.5, 9);
    expect(said[3]).toBeCloseTo(0.205, 9);
    expect(said[4]).toBeUndefined();
  });

  it('goes round a loop until released', async () => {
    const engine = await offlineEngine(1);
    engine
      .chain()
      .sampler({ id: 's', buffer: ramp(), start: 0.2, end: 0.3, loop: true })
      .to('main');
    const s = engine.select('#s');
    s.trigger({ at: 0 });
    s.release({ at: 0.75 });
    const said = await check(engine, [0.05, 0.15, 0.25, 0.42, 0.74, 0.75, 0.8]);
    expect(said[0]).toBeCloseTo(0.25, 9);
    expect(said[1]).toBeCloseTo(0.25, 9);
    expect(said[3]).toBeCloseTo(0.22, 9);
    expect(said[4]).toBeCloseTo(0.24, 9);
    expect(said[5]).toBeUndefined();
  });

  it('goes round a loop backwards', async () => {
    const engine = await offlineEngine(0.5);
    engine
      .chain()
      .sampler({ id: 's', buffer: ramp(), start: 0.2, end: 0.3, loop: true, reverse: true })
      .to('main');
    engine.select('#s').trigger({ at: 0 });
    const said = await check(engine, [0.05, 0.12, 0.25, 0.42], { reverse: true });
    expect(said[0]).toBeCloseTo(0.25, 9);
    expect(said[1]).toBeCloseTo(0.28, 9);
    expect(said[3]).toBeCloseTo(0.28, 9);
  });

  it('is inside the slice a trigger plays', async () => {
    const engine = await offlineEngine(1);
    engine.buffers.add('ramp', ramp()).slices = [0, 0.25, 0.5, 0.75, 1];
    engine.chain().sampler({ id: 's', buffer: 'ramp' }).to('main');
    engine.select('#s').trigger({ at: 0.1, slice: 2, speed: 0.5 });
    const said = await check(engine, [0.1, 0.3, 0.59, 0.6], { edges: [0.1, 0.6] });
    expect(said[0]).toBeCloseTo(0.5, 9);
    expect(said[1]).toBeCloseTo(0.6, 9);
    expect(said[3]).toBeUndefined();
  });

  it('stops where a duration, a release or a choking trigger stops the voice', async () => {
    const engine = await offlineEngine(1);
    engine.chain().sampler({ id: 's', buffer: ramp() }).to('main');
    const s = engine.select('#s');
    s.trigger({ at: 0, duration: 0.1 });
    s.trigger({ at: 0.3 });
    s.trigger({ at: 0.5, start: 0.5 });
    s.release({ at: 0.7 });
    const said = await check(engine, [0.05, 0.1, 0.2, 0.4, 0.5, 0.6, 0.7]);
    expect(said).toEqual([0.05, undefined, undefined, expect.closeTo(0.1, 9), 0.5, 0.6, undefined]);
  });

  it('gives one position per sounding voice, oldest first, into the list it is handed', async () => {
    const engine = await offlineEngine(1);
    engine.chain().sampler({ id: 's', buffer: ramp(), choke: false }).to('main');
    const s = engine.select('#s');
    s.trigger({ at: 0 });
    s.trigger({ at: 0.25 });
    const node = s.first()!;
    const list: number[] = [9, 9, 9];
    expect(node.playheads(0.5, list)).toBe(list);
    expect(list).toEqual([0.5, 0.25]);
    expect(node.playheads(0.1, list)).toEqual([0.1]);
    expect(node.playheads(2, list)).toEqual([]);
    // With no time: now, which before the render starts is 0.
    expect(node.playheads()).toEqual([0]);
    const audio = (await engine.render()).getChannelData(0);
    expect(audio[0.5 * SAMPLE_RATE]).toBeCloseTo(0.75, 6);
  });

  it('is empty for a sampler with no buffer, for other node types, and after dispose', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().sampler({ id: 'empty' }).gain({ id: 'g' }).to('main');
    engine.chain().sine({ id: 'osc' }).to('main');
    engine.chain().sampler({ id: 's', buffer: ramp() }).to('main');
    engine.select('*').trigger({ at: 0 });
    expect(engine.select('#empty').first()!.playheads(0.05)).toEqual([]);
    expect(engine.select('#g').first()!.playheads(0.05)).toEqual([]);
    expect(engine.select('#osc').first()!.playheads(0.05)).toEqual([]);
    const node = engine.select('#s').first()!;
    expect(node.playheads(0.05)).toEqual([0.05]);
    node.dispose();
    expect(node.playheads(0.05)).toEqual([]);
  });
});
