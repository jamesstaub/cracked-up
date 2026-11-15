import { describe, expect, it } from 'vitest';
import { addSlice, moveSlice, removeSlice, sliceByOnsets } from '../../src/util';
import { SAMPLE_RATE, makeBuffer, offlineEngine, valueAt } from './setup';

/** One second whose level says where you are in it: 0.05 in the first tenth, 0.15 in the second... */
const stairs = () => makeBuffer(1, (i) => Math.floor((i * 10) / SAMPLE_RATE) / 10 + 0.05);

describe('slices as data a host edits', () => {
  it('reads, replaces, and edits one boundary at a time', async () => {
    const engine = await offlineEngine(0.1);
    const ref = engine.buffers.add('stairs', stairs());
    expect(ref.slices).toEqual([0, 1]);
    ref.slices = [0.5, 0, 1];
    expect(ref.slices).toEqual([0, 0.5, 1]);
    ref.slices = addSlice(ref.slices, 0.25, ref.duration ?? undefined);
    expect(ref.slices).toEqual([0, 0.25, 0.5, 1]);
    ref.slices = moveSlice(ref.slices, 1, 0.9, ref.duration ?? undefined);
    expect(ref.slices).toEqual([0, 0.499, 0.5, 1]);
    ref.slices = removeSlice(ref.slices, 1);
    expect(ref.slices).toEqual([0, 0.5, 1]);
    // Fewer than two boundaries: the whole sound again.
    ref.slices = [];
    expect(ref.slices).toEqual([0, 1]);
  });

  it('tells store listeners when slices change, and only then', async () => {
    const engine = await offlineEngine(0.1);
    const ref = engine.buffers.add('stairs', stairs());
    const heard: string[] = [];
    const off = engine.buffers.on('slices', (changed) =>
      heard.push(`${changed.key}: ${changed.slices.join(' ')}`),
    );
    ref.slices = [0, 0.5, 1];
    ref.slices = [0, 0.5, 1];
    ref.slices = [1, 0.5, 0];
    ref.slices = addSlice(ref.slices, 0.75);
    // Back to the default, and the default again.
    ref.slices = [];
    ref.slices = [0, 1];
    expect(heard).toEqual(['stairs: 0 0.5 1', 'stairs: 0 0.5 0.75 1', 'stairs: 0 1']);
    off();
    ref.slices = [0, 0.1, 1];
    expect(heard).toHaveLength(3);
  });

  it('tells store listeners when the audio of an entry changes', async () => {
    const engine = await offlineEngine(0.2);
    const ready: string[] = [];
    engine.buffers.on('ready', (ref) => ready.push(`${ref.key} ${ref.duration}`));
    engine.buffers.add('stairs', stairs());
    await Promise.resolve();
    await Promise.resolve();
    expect(ready).toEqual(['stairs 1']);
  });

  it('a trigger reads the slices when it is called: scheduled voices keep theirs, later ones use the new list', async () => {
    const render = async (edit: boolean) => {
      const engine = await offlineEngine(1);
      const ref = engine.buffers.add('stairs', stairs());
      ref.slices = [0, 0.2, 0.4, 1];
      engine.chain().sampler({ id: 's', buffer: 'stairs' }).to('main');
      const s = engine.select('#s');
      const before = engine.select('*').nodes[0];
      // Slice 1 of the first list: 0.2 to 0.4.
      s.trigger({ at: 0, slice: 1 });
      if (edit) {
        ref.slices = moveSlice(ref.slices, 1, 0.3);
        ref.slices = removeSlice(ref.slices, 2);
        expect(ref.slices).toEqual([0, 0.3, 1]);
      }
      // Slice 1 of whichever list is there now, and slice 5, which wraps.
      s.trigger({ at: 0.3, slice: 1, duration: 0.2 });
      s.trigger({ at: 0.6, slice: 5 });
      expect(engine.select('*').nodes[0]).toBe(before);
      return (await engine.render()).getChannelData(0);
    };
    const kept = await render(false);
    const edited = await render(true);
    const at = (seconds: number) => Math.round(seconds * SAMPLE_RATE);
    // The voice scheduled before the edit plays its old region, sample for sample, to its end.
    expect(edited.slice(0, at(0.3))).toEqual(kept.slice(0, at(0.3)));
    expect(edited[at(0.05)]).toBeCloseTo(0.25, 6);
    expect(edited[at(0.15)]).toBeCloseTo(0.35, 6);
    expect(edited[at(0.25)]).toBe(0);
    // The next one uses the new list: slice 1 now starts at 0.3 ...
    expect(kept[at(0.35)]).toBeCloseTo(0.25, 6);
    expect(edited[at(0.35)]).toBeCloseTo(0.35, 6);
    // ... and slice 5 of two slices is slice 1; of three it was slice 2.
    expect(kept[at(0.65)]).toBeCloseTo(0.45, 6);
    expect(edited[at(0.65)]).toBeCloseTo(0.35, 6);
  });

  it('boundaries outside the sound are played as far as the sound goes', async () => {
    const engine = await offlineEngine(1);
    const ref = engine.buffers.add('stairs', stairs());
    ref.slices = [0, 0.9, 5];
    engine.chain().sampler({ id: 's', buffer: 'stairs' }).to('main');
    engine.select('#s').trigger({ at: 0, slice: 1 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.05)).toBeCloseTo(0.95, 6);
    expect(valueAt(audio, 0.15)).toBe(0);
  });

  it('slices from onsets play each hit from its first sample', async () => {
    const engine = await offlineEngine(0.5);
    const hits = makeBuffer(1, (i) => {
      const since = (i / SAMPLE_RATE) % 0.25;
      return Math.exp(-since / 0.02) * (i % 2 ? 0.5 : -0.5);
    });
    const ref = engine.buffers.add('hits', hits);
    ref.slices = sliceByOnsets(hits);
    expect(ref.slices).toEqual([0, 0.25, 0.5, 0.75, 1]);
    engine.chain().sampler({ id: 's', buffer: 'hits' }).to('main');
    engine.select('#s').trigger({ at: 0.1, slice: 2 });
    const audio = (await engine.render()).getChannelData(0);
    const from = 0.1 * SAMPLE_RATE;
    expect(audio.slice(from, from + 0.25 * SAMPLE_RATE)).toEqual(
      hits.getChannelData(0).slice(0.5 * SAMPLE_RATE, 0.75 * SAMPLE_RATE),
    );
  });

  it('slices live in the buffer store: a graph description names the buffer, and they survive a round trip', async () => {
    const engine = await offlineEngine(0.5);
    const ref = engine.buffers.add('stairs', stairs());
    ref.slices = [0, 0.3, 1];
    const scope = engine.scope('track');
    scope.chain().sampler({ id: 's', buffer: 'stairs' }).to('main');
    const described = scope.describe();
    expect(described.nodes[0]).toMatchObject({ id: 's', init: { buffer: 'stairs' } });
    expect(JSON.stringify(scope.snapshot())).not.toContain('0.3');

    // Emptied and applied again from JSON: a new sampler, the same store entry, the same slices.
    await scope.apply({ nodes: [], edges: [] });
    await scope.apply(JSON.parse(JSON.stringify(described)) as typeof described);
    expect(engine.buffers.get('stairs')?.slices).toEqual([0, 0.3, 1]);
    scope.select('#s').trigger({ at: 0, slice: 1 });
    expect(valueAt(await engine.render(), 0.05)).toBeCloseTo(0.35, 6);
  });

  it('a slices command sets them, and reports a buffer that is not there', async () => {
    const engine = await offlineEngine(0.1);
    engine.buffers.add('stairs', stairs());
    const errors: string[] = [];
    engine.root.on('error', (error) => errors.push(error.message));
    engine.root.dispatch([
      { op: 'slices', key: 'stairs', slices: [0, 0.5, 1] },
      { op: 'slices', key: 'nope', slices: [0, 1] },
    ]);
    expect(engine.buffers.get('stairs')?.slices).toEqual([0, 0.5, 1]);
    expect(errors).toEqual(['There is no buffer called "nope".']);
  });
});
