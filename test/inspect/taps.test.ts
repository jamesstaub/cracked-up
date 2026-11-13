import { afterEach, describe, expect, it } from 'vitest';
import type { Engine } from '../../src';
import { measure } from '../../src/inspect/meter';
import { nodesOf } from '../../src/inspect/model';
import { TapSet } from '../../src/inspect/taps';
import { SAMPLE_RATE, offlineEngine, ones } from '../core/setup';
import { firstDifference, liveEngine, wait, watchAnalysers } from './util';

/** A graph with a filter, a feedback loop inside a macro, modulation, a bypassed node and a bus. */
function build(engine: Engine): void {
  engine.bus('mix');
  engine.chain().sine({ id: 'tone', frequency: 330 }).lowpass({ id: 'filter' }).to('mix');
  engine.chain().lfo({ id: 'wobble', frequency: 3, depth: 200 }).modulate('#filter', 'frequency');
  engine
    .chain()
    .sampler({ id: 'dc', buffer: ones(0.01) })
    .gain({ id: 'half', gain: 0.5, bypass: true })
    .tapedelay({ id: 'echo', time: 0.05, feedback: 0.6, mix: 0.5 })
    .to('mix');
  engine.select('#dc').trigger({ at: 0.01 });
}

/** Every output the inspector could listen to: each node, the nodes inside the macro, and the buses. */
function outputs(engine: Engine): Map<string, AudioNode> {
  const wanted = new Map<string, AudioNode>();
  for (const node of nodesOf(engine.root)) {
    if (node.output) wanted.set(node.id, node.output);
    for (const inner of node.insideScope ? nodesOf(node.insideScope) : []) {
      if (inner.output) wanted.set(`${node.id}/${inner.id}`, inner.output);
    }
  }
  wanted.set('bus mix', engine.bus('mix').output);
  wanted.set('bus main', engine.bus('main').output);
  return wanted;
}

async function render(taps: 'none' | 'attached' | 'removed'): Promise<AudioBuffer> {
  const engine = await offlineEngine(0.4, 2);
  build(engine);
  if (taps !== 'none') {
    const set = new TapSet(engine.context);
    const wanted = outputs(engine);
    set.sync(wanted, 0);
    expect(set.count).toBe(wanted.size);
    expect(set.count).toBeGreaterThan(20);
    if (taps === 'removed') set.clear();
  }
  return engine.render();
}

describe('taps', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('do not change the audio: a render with a tap on every output is sample for sample the same', async () => {
    const plain = await render('none');
    // The render is not silence, so the comparison means something.
    expect(measure(plain.getChannelData(0)).peak).toBeGreaterThan(0.1);
    expect(firstDifference(plain, await render('attached'))).toBe(-1);
    expect(firstDifference(plain, await render('removed'))).toBe(-1);
  });

  it('leave describe() as it was', async () => {
    const engine = await offlineEngine(0.1);
    build(engine);
    const inside = engine.select('#echo').first()!.insideScope!;
    const before = JSON.stringify([engine.root.snapshot(), inside.snapshot()]);
    const set = new TapSet(engine.context);
    set.sync(outputs(engine), 0);
    expect(JSON.stringify([engine.root.snapshot(), inside.snapshot()])).toBe(before);
    set.clear();
    expect(JSON.stringify([engine.root.snapshot(), inside.snapshot()])).toBe(before);
  });

  it('make one connection per output and remove every one of them', async () => {
    const engine = await offlineEngine(0.1);
    build(engine);
    const watch = watchAnalysers();
    restore = watch.restore;
    const set = new TapSet(engine.context);
    const wanted = outputs(engine);

    set.sync(wanted, 0);
    expect(watch.open).toBe(wanted.size);
    // Asking again for the same outputs makes nothing new.
    set.sync(wanted, 0.016);
    expect(watch.made).toBe(wanted.size);

    set.clear();
    expect(set.count).toBe(0);
    expect(watch.open).toBe(0);
  });

  it('keep a tap nobody wants for a second, then remove it', async () => {
    const engine = await offlineEngine(0.1);
    build(engine);
    const watch = watchAnalysers();
    restore = watch.restore;
    const set = new TapSet(engine.context);
    const tone = new Map([['tone', engine.select('#tone').first()!.output!]]);
    set.sync(tone, 0);
    set.sync(new Map(), 0.5);
    expect(set.has('tone')).toBe(true);
    // Wanted again in time: it is the same tap.
    set.sync(tone, 0.4);
    set.sync(new Map(), 0.9);
    expect(set.has('tone')).toBe(true);
    expect(watch.made).toBe(1);
    set.sync(new Map(), 0.2);
    expect(set.has('tone')).toBe(false);
    expect(watch.open).toBe(0);
  });

  it('move to the new output when a node is bypassed for the first time', async () => {
    const engine = await offlineEngine(0.1);
    build(engine);
    const watch = watchAnalysers();
    restore = watch.restore;
    const filter = engine.select('#filter').first()!;
    const set = new TapSet(engine.context);
    const before = filter.output!;
    set.sync(new Map([['filter', before]]), 0);
    filter.bypass = true;
    // Bypassing puts the node behind a switch, and the switch is now its output.
    expect(filter.output).not.toBe(before);
    set.sync(new Map([['filter', filter.output!]]), 0.016);
    expect(set.count).toBe(1);
    expect(watch.open).toBe(1);
    expect(watch.made).toBe(2);
    set.clear();
    expect(watch.open).toBe(0);
  });

  it('survive the node being disposed first', async () => {
    const engine = await offlineEngine(0.1);
    build(engine);
    const set = new TapSet(engine.context);
    set.sync(outputs(engine), 0);
    engine.select('*').dispose();
    expect(() => set.clear()).not.toThrow();
    expect(set.count).toBe(0);
  });

  it('read the signal at an output of a running context, and nothing where there is none', async (test) => {
    const { engine, context, running } = await liveEngine();
    try {
      if (!running) return test.skip();
      engine
        .chain()
        .sine({ id: 'loud', frequency: 440 })
        .gain({ id: 'half', gain: 0.5 })
        .to('main');
      engine.chain().sine({ id: 'quiet', gate: 'closed' }).gain({ id: 'never' }).to('main');
      engine.chain().lfo({ id: 'slow', frequency: 5, depth: 80 }).modulate('#loud', 'detune');
      const set = new TapSet(context);
      const output = (id: string): AudioNode => engine.select(`#${id}`).first()!.output!;
      set.sync(new Map(['loud', 'half', 'never', 'slow'].map((id) => [id, output(id)])), 0);
      await wait(300);

      const loud = measure(set.read('loud')!);
      expect(loud.peak).toBeGreaterThan(0.9);
      expect(loud.peak).toBeLessThan(1.05);
      const half = measure(set.read('half')!);
      expect(half.peak).toBeCloseTo(loud.peak / 2, 1);
      expect(half.rms).toBeCloseTo(0.5 / Math.SQRT2, 1);
      // A chain nothing has triggered reads as exact silence.
      expect(measure(set.read('never')!).peak).toBe(0);
      // An lfo of depth 80 stays within 80 of zero. One block is too short to see its whole swing.
      const slow = measure(set.read('slow')!);
      expect(slow.max).toBeLessThanOrEqual(80.5);
      expect(slow.min).toBeGreaterThanOrEqual(-80.5);
      expect(slow.peak).toBeGreaterThan(1);
      expect(set.read('missing')).toBeNull();
      // One reading covers more than a frame at 60 per second, so consecutive readings leave no gap.
      expect(set.size / SAMPLE_RATE).toBeGreaterThan(1 / 60);
      set.clear();
    } finally {
      engine.dispose();
      await context.close();
    }
  });
});
