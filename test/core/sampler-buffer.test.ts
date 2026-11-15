import { describe, expect, it } from 'vitest';
import type { Engine, ScopeApi } from '../../src';
import { SAMPLE_RATE, makeBuffer, offlineEngine, valueAt } from './setup';

const level = (seconds: number, value: number) => makeBuffer(seconds, () => value);
const at = (seconds: number) => Math.round(seconds * SAMPLE_RATE);

/** An engine with a long quiet sound, 'low' (0.25 for 1 s), and a short loud one, 'high' (0.75 for 0.2 s). */
async function setup(seconds = 1): Promise<Engine> {
  const engine = await offlineEngine(seconds);
  engine.buffers.add('low', level(1, 0.25));
  engine.buffers.add('high', level(0.2, 0.75));
  return engine;
}

describe('changing a sampler’s buffer in place', () => {
  it('lets sounding voices finish on the old sound and plays the new one from the next trigger', async () => {
    const reference = await setup();
    reference.chain().sampler({ id: 's', buffer: 'low', choke: false }).to('main');
    reference.select('#s').trigger({ at: 0 });
    const alone = (await reference.render()).getChannelData(0);

    const engine = await setup();
    engine.chain().sampler({ id: 's', buffer: 'low', choke: false, gain: 0.5 }).to('main');
    const s = engine.select('#s');
    const node = s.first()!;
    const changes: string[] = [];
    engine.root.on('option:changed', (change) =>
      changes.push(`${change.node.id}.${change.name}=${String(change.value)}@${change.at}`),
    );
    s.set({ gain: 1 });
    s.trigger({ at: 0 });
    s.setOption('buffer', 'high');
    s.setOption('buffer', 'high');
    s.trigger({ at: 0.5 });
    expect(changes).toEqual(['s.buffer=high@0']);
    expect(engine.select('#s').first()).toBe(node);
    expect(s.param('gain').value).toBe(1);
    expect(engine.root.describe().nodes[0]?.init).toEqual({ buffer: 'high', choke: false });

    const audio = (await engine.render()).getChannelData(0);
    // The first voice plays 'low' to its end, exactly as if nothing had changed ...
    expect(audio.slice(0, at(0.5))).toEqual(alone.slice(0, at(0.5)));
    expect(audio[at(0.95)]).toBeCloseTo(0.25, 6);
    // ... and the second plays 'high' on top of it, for as long as 'high' lasts.
    expect(audio[at(0.6)]).toBeCloseTo(1, 6);
    expect(audio[at(0.75)]).toBeCloseTo(0.25, 6);
  });

  it('takes effect at a time: triggers before it play the old sound, triggers from it on the new', async () => {
    const engine = await setup();
    engine.chain().sampler({ id: 's', buffer: 'low' }).to('main');
    const s = engine.select('#s');
    s.setOption('buffer', 'high', { at: 0.4 });
    s.trigger({ at: 0.1, duration: 0.05 });
    s.trigger({ at: 0.4, duration: 0.05 });
    s.trigger({ at: 0.6, duration: 0.05 });
    // A later change replaces what was scheduled after it.
    s.setOption('buffer', 'low', { at: 0.8 });
    s.setOption('buffer', 'high', { at: 0.9 });
    s.setOption('buffer', 'low', { at: 0.7 });
    s.trigger({ at: 0.92, duration: 0.05 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.12)).toBeCloseTo(0.25, 6);
    expect(valueAt(audio, 0.42)).toBeCloseTo(0.75, 6);
    expect(valueAt(audio, 0.62)).toBeCloseTo(0.75, 6);
    expect(valueAt(audio, 0.94)).toBeCloseTo(0.25, 6);
  });

  it('inside a sequence callback, applies at the event', async () => {
    const engine = await setup();
    engine.chain().sampler({ id: 's', buffer: 'low' }).to('main');
    engine.transport.bpm = 120;
    engine.transport.sequence('swap', { steps: [1, 1], step: '1/4' }, (ev) => {
      engine
        .select('#s')
        .setOption('buffer', ev.index === 0 ? 'low' : 'high')
        .trigger({ duration: 0.1 });
    });
    engine.transport.start();
    const audio = await engine.render();
    expect(valueAt(audio, 0.05)).toBeCloseTo(0.25, 6);
    expect(valueAt(audio, 0.55)).toBeCloseTo(0.75, 6);
  });

  it('keeps start and end: an end past the new sound stops at its end, a start past it plays nothing', async () => {
    const engine = await setup();
    engine.chain().sampler({ id: 's', buffer: 'low', start: 0.1, end: 0.9 }).to('main');
    const s = engine.select('#s');
    s.setOption('buffer', 'high');
    s.trigger({ at: 0 });
    s.trigger({ at: 0.5, start: 0.3 });
    const audio = await engine.render();
    expect(s.param('start').value).toBe(0.1);
    expect(s.param('end').value).toBe(0.9);
    // From 0.1 to the end of the 0.2 s sound.
    expect(valueAt(audio, 0.05)).toBeCloseTo(0.75, 6);
    expect(valueAt(audio, 0.15)).toBe(0);
    expect(valueAt(audio, 0.55)).toBe(0);
  });

  it('accepts whatever the option accepts at creation, and nothing at all', async () => {
    const engine = await setup();
    engine.chain().sampler({ id: 's', buffer: 'low' }).to('main');
    const s = engine.select('#s');
    const node = s.first()!;
    node.setOption('buffer', level(0.1, 0.5), { at: 0.2 });
    node.setOption('buffer', engine.buffers.get('high'), { at: 0.4 });
    node.setOption('buffer', undefined, { at: 0.6 });
    for (const time of [0, 0.2, 0.4, 0.6]) s.trigger({ at: time, duration: 0.05 });
    expect(engine.root.describe().nodes[0]?.init).toBeUndefined();
    const audio = await engine.render();
    expect(valueAt(audio, 0.02)).toBeCloseTo(0.25, 6);
    expect(valueAt(audio, 0.22)).toBeCloseTo(0.5, 6);
    expect(valueAt(audio, 0.42)).toBeCloseTo(0.75, 6);
    expect(valueAt(audio, 0.62)).toBe(0);
  });

  it('refuses an option that is fixed at creation, and skips nodes without the option in a selection', async () => {
    const engine = await setup(0.1);
    engine.chain().sampler({ id: 's', buffer: 'low' }).gain({ id: 'g' }).to('main');
    const node = engine.select('#s').first()!;
    expect(() => node.setOption('choke', false)).toThrow(
      /no option called "choke" that can be changed/,
    );
    expect(() => engine.select('#g').first()!.setOption('buffer', 'high')).toThrow(/no option/);
    engine.select('*').setOption('buffer', 'high');
    expect(engine.root.describe().nodes.map((data) => data.init)).toEqual([
      { buffer: 'high' },
      undefined,
    ]);
    expect(engine.registry.describe('sampler').options['buffer']?.live).toBe(true);
    expect(engine.registry.describe('sampler').options['choke']?.live).toBeUndefined();
  });

  it('is reached by the option command', async () => {
    const engine = await setup(0.2);
    engine.chain().sampler({ id: 's', buffer: 'low' }).to('main');
    engine.root.dispatch([
      { op: 'option', target: '#s', at: 0, name: 'buffer', value: 'high' },
      { op: 'trigger', target: '#s', at: 0 },
    ]);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.75, 6);
  });
});

describe('build() and apply() with a different buffer', () => {
  const script =
    (buffer: string, extra: (__: ScopeApi) => void = () => {}) =>
    (__: ScopeApi): void => {
      __().sampler({ id: 's', buffer, choke: false }).gain({ id: 'g', gain: 0.5 }).to('main');
      extra(__);
    };

  it('build keeps the node and changes its buffer in place', async () => {
    const reference = await setup();
    const quiet = reference.scope('live');
    await quiet.build(script('low'));
    quiet.select('#s').trigger({ at: 0 });
    const alone = (await reference.render()).getChannelData(0);

    const engine = await setup();
    const scope = engine.scope('live');
    await scope.build(script('low'));
    const node = scope.select('#s').first()!;
    scope.select('#s').trigger({ at: 0 });
    const events: string[] = [];
    scope.on('node:added', (added) => events.push(`added ${added.id}`));
    scope.on('node:removed', (id) => events.push(`removed ${id}`));
    scope.on('option:changed', (change) => events.push(`${change.name}=${String(change.value)}`));

    const result = await scope.build(script('high'));
    expect(scope.select('#s').first()).toBe(node);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.updated.map((kept) => kept.id)).toEqual(['s']);
    expect(result.unchanged.map((kept) => kept.id)).toEqual(['g']);
    expect(events).toEqual(['buffer=high']);
    expect(scope.describe().nodes[0]?.init).toEqual({ buffer: 'high', choke: false });

    // Run again unchanged: nothing to do.
    const again = await scope.build(script('high'));
    expect(again.unchanged.map((kept) => kept.id)).toEqual(['s', 'g']);
    expect(events).toEqual(['buffer=high']);

    scope.select('#s').trigger({ at: 0.5 });
    const audio = (await engine.render()).getChannelData(0);
    expect(audio.slice(0, at(0.5))).toEqual(alone.slice(0, at(0.5)));
    expect(audio[at(0.6)]).toBeCloseTo(0.5, 6);
    expect(audio[at(0.75)]).toBeCloseTo(0.125, 6);
  });

  it('a setOption in the build after the node has the last word, run after run', async () => {
    const engine = await setup(0.2);
    const scope = engine.scope('live');
    // The script says 'low'; the host's choice, made at top level of the same run, says 'high'.
    const run = script('low', (__) => __('#s').setOption('buffer', 'high'));
    await scope.build(run);
    const node = scope.select('#s').first()!;
    const events: string[] = [];
    scope.on('option:changed', (change) => events.push(String(change.value)));
    const result = await scope.build(run);
    expect(scope.select('#s').first()).toBe(node);
    expect(result.unchanged.map((kept) => kept.id)).toEqual(['s', 'g']);
    expect(events).toEqual([]);
    expect(scope.describe().nodes[0]?.init).toEqual({ buffer: 'high', choke: false });
    scope.select('#s').trigger({ at: 0 });
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.375, 6);
  });

  it('a build that fails leaves the buffer as it was', async () => {
    const engine = await setup(0.2);
    const scope = engine.scope('live');
    await scope.build(script('low'));
    const events: string[] = [];
    scope.on('option:changed', (change) => events.push(String(change.value)));
    await expect(
      scope.build(
        script('high', () => {
          throw new Error('typo');
        }),
      ),
    ).rejects.toThrow('typo');
    await expect(
      scope.build(script('high', (__) => __('#g').set({ gain: 'loud' as never }))),
    ).rejects.toThrow();
    expect(events).toEqual([]);
    expect(scope.describe().nodes[0]?.init).toEqual({ buffer: 'low', choke: false });
    scope.select('#s').trigger({ at: 0 });
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.125, 6);
  });

  it('still replaces the node when an option fixed at creation changes', async () => {
    const engine = await setup(0.1);
    const scope = engine.scope('live');
    await scope.build((__) => __().sampler({ id: 's', buffer: 'low', choke: false }).to('main'));
    const node = scope.select('#s').first()!;
    const result = await scope.build((__) =>
      __().sampler({ id: 's', buffer: 'high', choke: true }).to('main'),
    );
    expect(scope.select('#s').first()).not.toBe(node);
    expect(result.removed).toEqual(['s']);
    expect(result.added.map((added) => added.id)).toEqual(['s']);
  });

  it('apply keeps the node too, for a described buffer key', async () => {
    const engine = await setup(0.2);
    const scope = engine.scope('live');
    scope.chain().sampler({ id: 's', buffer: 'low' }).to('main');
    const node = scope.select('#s').first()!;
    const graph = scope.describe();
    const result = await scope.apply({
      ...graph,
      nodes: graph.nodes.map((data) => ({ ...data, init: { buffer: 'high' } })),
    });
    expect(result.errors).toEqual([]);
    expect(scope.select('#s').first()).toBe(node);
    expect(result.updated.map((kept) => kept.id)).toEqual(['s']);
    scope.select('#s').trigger({ at: 0 });
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.75, 6);
  });
});

describe('what a sampler plays, for a host', () => {
  it('node.buffer is the store entry: its key, length and slices give the real range of start and end', async () => {
    const engine = await setup(0.1);
    engine.chain().sampler({ id: 's', buffer: 'low' }).gain({ id: 'g' }).to('main');
    engine.chain().sampler({ id: 'empty' }).to('main');
    const node = engine.select('#s').first()!;
    expect(node.buffer).toBe(engine.buffers.get('low'));
    expect(node.buffer?.key).toBe('low');
    expect(node.buffer?.duration).toBe(1);
    expect(node.param('end').meta).toMatchObject({ min: 0, max: 60, unit: 'seconds' });
    node.buffer!.slices = [0, 0.5, 1];
    expect(engine.buffers.get('low')?.slices).toEqual([0, 0.5, 1]);

    node.setOption('buffer', 'high', { at: 0.05 });
    expect(node.buffer?.key).toBe('high');
    expect(node.buffer?.duration).toBeCloseTo(0.2, 9);
    node.setOption('buffer', undefined);
    expect(node.buffer).toBeNull();

    expect(engine.select('#empty').first()!.buffer).toBeNull();
    expect(engine.select('#g').first()!.buffer).toBeNull();
    const made = level(0.3, 1);
    engine.chain().sampler({ id: 'own', buffer: made }).to('main');
    expect(engine.select('#own').first()!.buffer?.buffer).toBe(made);
    node.dispose();
    expect(node.buffer).toBeNull();
  });

  it('a buffer still loading has a key and no duration yet', async () => {
    const engine = await setup(0.1);
    const encoded = new ArrayBuffer(8);
    const ref = engine.buffers.add('pending', encoded);
    ref.ready.catch(() => {});
    engine.chain().sampler({ id: 's', buffer: 'pending' }).to('main');
    const node = engine.select('#s').first()!;
    expect(node.buffer?.key).toBe('pending');
    expect(node.buffer?.duration).toBeNull();
  });
});

describe('parameter metadata of the built-in types', () => {
  it('gives every level a gain or decibel unit, every frequency hertz and a log curve, every time seconds', async () => {
    const engine = await setup(0.1);
    const wrong: string[] = [];
    for (const info of engine.registry.list()) {
      for (const meta of info.params) {
        if (meta.kind !== 'number') continue;
        const name = meta.name.toLowerCase();
        const where = `${info.type}.${meta.name}`;
        const isLevel = /gain$|^monitor$|^overdub$|^sustain$|^feedback$/.test(name);
        if (isLevel && !['gain', 'db'].includes(meta.unit)) wrong.push(`${where}: ${meta.unit}`);
        const isFrequency =
          /frequency$|cutoff$|crossover$|^tone$|^lowcut$|^color$|^postcut$|rate$/.test(name);
        if (
          isFrequency &&
          info.type !== 'bitcrusher' &&
          (meta.unit !== 'hz' || meta.curve !== 'log')
        ) {
          wrong.push(`${where}: ${meta.unit} ${meta.curve}`);
        }
        const isTime = /^(time|attack|decay|release|latency|start|end|loopstart|loopend)$/.test(
          name,
        );
        if (isTime && meta.unit !== 'seconds') wrong.push(`${where}: ${meta.unit}`);
        if (/threshold$|knee$/.test(name) && meta.unit !== 'db')
          wrong.push(`${where}: ${meta.unit}`);
        if (/detune$/.test(name) && meta.unit !== 'cents') wrong.push(`${where}: ${meta.unit}`);
        if (name === 'pan' && meta.unit !== 'pan') wrong.push(`${where}: ${meta.unit}`);
        if (/ratio$|^speed$/.test(name) && meta.unit !== 'ratio')
          wrong.push(`${where}: ${meta.unit}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
