import { describe, expect, it } from 'vitest';
import { CrackedUpError, defineNode } from '../../src';
import type { Command, GraphError } from '../../src';
import { dominantFrequency, rms } from '../helpers';
import { click, constant, offlineEngine, ones, valueAt } from './setup';

describe('chains', () => {
  it('connects each node to the next and ends at a bus', async () => {
    const engine = await offlineEngine(0.5);
    engine.chain().sine(440).gain(0.5).to('main');
    const audio = await engine.render();
    expect(dominantFrequency(audio)).toBeCloseTo(440, 0);
    expect(rms(audio)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('is immutable: continuing a kept chain twice makes two branches', async () => {
    const engine = await offlineEngine(0.2);
    const source = constant(engine, 0.2);
    source.gain(0.5).to('main');
    source.gain(0.25).to('main');
    expect(engine.select('gain')).toHaveLength(2);
    expect(engine.select('#dc').first()?.outputs).toHaveLength(2);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.75, 6);
  });

  it('split runs branches in parallel and continues from all of them', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2)
      .split(
        (a) => a.gain(0.5),
        (b) => b.gain(0.25),
      )
      .gain({ id: 'sum', gain: 2 })
      .to('main');
    expect(engine.select('#sum').first()?.inputs).toHaveLength(2);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(1.5, 6);
  });

  it('a selection can feed a new chain (fan-in)', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2, 'a');
    constant(engine, 0.2, 'b');
    engine.select('sampler').chain().gain(0.5).to('main');
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(1, 6);
  });

  it('chains started in any order do not affect each other', async () => {
    const engine = await offlineEngine(0.2);
    const first = constant(engine, 0.2, 'a');
    const second = constant(engine, 0.2, 'b');
    first.gain({ id: 'ga', gain: 0.5 }).to('main');
    second.gain({ id: 'gb', gain: 0.25 }).to('main');
    expect(
      engine
        .select('#ga')
        .first()
        ?.inputs.map((edge) => edge.from.id),
    ).toEqual(['a']);
    expect(
      engine
        .select('#gb')
        .first()
        ?.inputs.map((edge) => edge.from.id),
    ).toEqual(['b']);
  });

  it('refuses to chain into a node that has no input, and leaves nothing behind', async () => {
    const engine = await offlineEngine(0.1);
    expect(() => engine.chain().gain({ id: 'g' }).sine({ id: 'orphan' })).toThrowError(/no input/);
    expect(engine.select('#orphan')).toHaveLength(0);
    expect(engine.select('#g')).toHaveLength(1);
  });

  it('rejects a duplicate id within a scope', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().gain({ id: 'same' });
    let error: unknown;
    try {
      engine.chain().gain({ id: 'same' });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(CrackedUpError);
    expect((error as CrackedUpError).code).toBe('duplicate-id');
  });
});

describe('buses', () => {
  it('only main exists by default, and an unknown bus name fails clearly', async () => {
    const engine = await offlineEngine(0.1);
    expect(() => engine.chain().gain().to('drums')).toThrowError(/no bus called "drums"/);
  });

  it('a created bus feeds main until routed elsewhere', async () => {
    const engine = await offlineEngine(0.2);
    engine.bus('fx').gain.set(0.5);
    engine.bus('quiet').gain.set(0.1);
    constant(engine, 0.2).to('fx');
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.5, 6);

    const rerouted = await offlineEngine(0.2);
    rerouted.bus('fx').gain.set(0.5);
    rerouted.bus('quiet').gain.set(0.1);
    rerouted.bus('fx').to('quiet');
    constant(rerouted, 0.2).to('fx');
    expect(valueAt(await rerouted.render(), 0.1)).toBeCloseTo(0.05, 6);
  });

  it('main carries stereo: a signal panned hard left reaches only the left channel', async () => {
    const engine = await offlineEngine(0.2, 2);
    constant(engine, 0.2).panner(-1).to('main');
    const audio = await engine.render();
    const at = Math.round(0.1 * audio.sampleRate);
    expect(audio.numberOfChannels).toBe(2);
    expect(audio.getChannelData(0)[at]).toBeCloseTo(1, 5);
    expect(audio.getChannelData(1)[at]).toBeCloseTo(0, 5);
  });

  it('a mono signal sent to main is heard equally on both sides', async () => {
    const engine = await offlineEngine(0.2, 2);
    constant(engine, 0.2).gain(0.5).to('main');
    const audio = await engine.render();
    const at = Math.round(0.1 * audio.sampleRate);
    expect(audio.getChannelData(0)[at]).toBeCloseTo(0.5, 6);
    expect(audio.getChannelData(1)[at]).toBeCloseTo(0.5, 6);
  });

  it('bus(name) returns the nearest bus of that name and creates one only when there is none', async () => {
    const engine = await offlineEngine(0.2);
    const a = engine.scope('a');
    // From any scope, `main` is the engine's output bus.
    expect(a.bus('main').input).toBe(engine.bus('main').input);
    expect(a.$.bus('main').gain).toBe(engine.bus('main').gain);
    expect(a.bus('main').scope).toBe(engine.root);

    // A name nobody has yet is created in the scope that asked, so sibling scopes do not see it.
    const own = a.bus('send');
    own.gain.set(0.5);
    expect(a.bus('send')).toBe(own);
    expect(() => engine.scope('b').chain().gain().to('send')).toThrowError(/no bus called "send"/);

    a.chain()
      .sampler({ id: 's', buffer: ones(0.2) })
      .to('send');
    a.select('#s').trigger({ at: 0 });
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.5, 6);
  });
});

describe('selections', () => {
  async function fixture() {
    const engine = await offlineEngine(0.1);
    engine.chain().sampler({ id: 'kick', class: 'drums low' }).gain({ id: 'k-level' }).to('main');
    engine
      .chain()
      .sampler({ id: 'hat', class: 'drums', tags: { role: 'top' } })
      .gain()
      .to('main');
    engine.chain().sine({ id: 'bass', class: 'low' }).lowpass().gain().to('main');
    return engine;
  }

  it('selects by type, id, class, tag, list, negation and position', async () => {
    const engine = await fixture();
    const ids = (selector: string) => engine.select(selector).nodes.map((node) => node.id);
    expect(ids('sampler')).toEqual(['kick', 'hat']);
    expect(ids('#bass')).toEqual(['bass']);
    expect(ids('.low')).toEqual(['kick', 'bass']);
    expect(ids('.low.drums')).toEqual(['kick']);
    expect(ids('[role=top]')).toEqual(['hat']);
    expect(ids('sine, sampler')).toEqual(['kick', 'hat', 'bass']);
    expect(ids('sampler:not(.low)')).toEqual(['hat']);
    expect(ids('gain:nth(1)')).toEqual(['gain-0']);
    expect(ids('gain')).toEqual(['k-level', 'gain-0', 'gain-1']);
    expect(ids('*')).toHaveLength(7);
  });

  it('a selection is a value: it does not change when the graph or other selections do', async () => {
    const engine = await fixture();
    const drums = engine.select('.drums');
    engine.select('sine');
    engine.chain().sampler({ class: 'drums' });
    expect(drums.nodes.map((node) => node.id)).toEqual(['kick', 'hat']);
    expect(drums.filter('.low').nodes.map((node) => node.id)).toEqual(['kick']);
    expect(drums.filter((node) => node.id === 'hat')).toHaveLength(1);
  });

  it('skips nodes that lack a parameter', async () => {
    const engine = await fixture();
    engine.select('*').set({ frequency: 100 });
    expect(engine.select('#bass').param('frequency').value).toBe(100);
    expect(engine.select('lowpass').param('frequency').value).toBe(100);
    expect(engine.select('*').params('frequency')).toHaveLength(2);
  });

  it('reports an invalid selector as a library error', async () => {
    const engine = await fixture();
    expect(() => engine.select('sampler >')).toThrowError(CrackedUpError);
  });

  it('`__` starts a chain with no argument and selects with one', async () => {
    const engine = await fixture();
    const __ = engine.$;
    __().gain({ id: 'extra' }).to('main');
    expect(__('#extra')).toHaveLength(1);
    expect(__.scope).toBe(engine.root);
  });
});

describe('scopes', () => {
  it('give each subtree its own id namespace', async () => {
    const engine = await offlineEngine(0.2);
    const a = engine.scope('a');
    const b = engine.scope('b');
    a.chain()
      .sampler({ id: 'src', buffer: ones(0.2) })
      .gain({ id: 'level', gain: 0.5 })
      .to('main');
    b.chain()
      .sampler({ id: 'src', buffer: ones(0.2) })
      .gain({ id: 'level', gain: 0.25 })
      .to('main');

    expect(a.select('#level')).toHaveLength(1);
    expect(a.select('#level').param('gain').value).toBe(0.5);
    expect(b.$('#level').param('gain').value).toBe(0.25);
    // From the root, the same selector reaches both.
    expect(engine.select('#level')).toHaveLength(2);
    expect(engine.scope('a')).toBe(a);

    engine.select('sampler').trigger({ at: 0 });
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.75, 6);
  });

  it('disposing a scope removes its nodes and leaves the others sounding', async () => {
    const engine = await offlineEngine(0.2);
    const a = engine.scope('a');
    const b = engine.scope('b');
    a.chain()
      .sampler({ id: 'src', buffer: ones(0.2) })
      .gain(0.5)
      .to('main');
    b.chain()
      .sampler({ id: 'src', buffer: ones(0.2) })
      .gain(0.25)
      .to('main');
    engine.select('sampler').trigger({ at: 0 });

    const removed: string[] = [];
    a.on('node:removed', (id) => removed.push(id));
    a.dispose();
    expect(removed.sort()).toEqual(['gain-0', 'src']);
    expect(engine.select('sampler')).toHaveLength(1);
    expect(engine.root.children).toEqual([b]);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.25, 6);
  });

  it('disposing a node removes its connections on both sides', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2).gain({ id: 'middle' }).gain({ id: 'last' }).to('main');
    engine.select('#middle').dispose();
    expect(engine.select('#dc').first()?.outputs).toHaveLength(0);
    expect(engine.select('#last').first()?.inputs).toHaveLength(0);
    expect(rms(await engine.render())).toBe(0);
  });

  it('describes its graph as plain data', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('track');
    scope
      .chain()
      .sine({ id: 'osc', frequency: 220, class: 'voice', tags: { role: 'lead' } })
      .lowpass({ id: 'filter', frequency: 900 })
      .to('main');
    scope
      .chain()
      .sine({ id: 'wobble', frequency: 2, gate: 'closed' })
      .modulate('#filter', 'frequency');

    expect(JSON.parse(JSON.stringify(scope.describe()))).toEqual({
      nodes: [
        {
          id: 'osc',
          type: 'sine',
          classes: ['voice'],
          tags: { role: 'lead' },
          params: { frequency: 220, detune: 0 },
        },
        { id: 'filter', type: 'lowpass', params: { frequency: 900, q: 1 } },
        {
          id: 'wobble',
          type: 'sine',
          params: { frequency: 2, detune: 0 },
          init: { gate: 'closed' },
        },
      ],
      edges: [
        { from: 'osc', to: { node: 'filter' } },
        { from: 'filter', to: { bus: 'main' } },
        { from: 'wobble', to: { node: 'filter', param: 'frequency' } },
      ],
    });
  });

  it('build runs a builder and reports what it added', async () => {
    const engine = await offlineEngine(0.1);
    const result = await engine.scope('t').build((__) => {
      __().sine({ id: 'osc' }).gain({ id: 'level' }).to('main');
    });
    expect(result.added.map((node) => node.id)).toEqual(['osc', 'level']);
  });
});

describe('engines', () => {
  it('are independent of each other', async () => {
    const a = await offlineEngine(0.1);
    const b = await offlineEngine(0.1);
    constant(a, 0.1).to('main');
    expect(a.select('#dc')).toHaveLength(1);
    expect(b.select('#dc')).toHaveLength(0);
    expect(rms(await a.render())).toBeGreaterThan(0.9);
    expect(rms(await b.render())).toBe(0);
  });

  it('publish metadata for every registered type', async () => {
    const engine = await offlineEngine(0.1);
    const info = engine.registry.describe('lowpass');
    expect(info).toMatchObject({ type: 'lowpass', category: 'filter', shorthand: 'frequency' });
    expect(info.params.map((param) => param.name)).toEqual(['frequency', 'q']);
    expect(engine.registry.describe('sampler').triggerable).toBe(true);
    expect(engine.registry.list().length).toBeGreaterThan(10);
  });

  it('accept custom node types, which get a chain method and setters', async () => {
    const doubler = defineNode({
      type: 'doubler',
      category: 'utility',
      params: { amount: { default: 2, min: 0, max: 4 } },
      build(context) {
        const node = new GainNode(context.audio);
        return { input: node, output: node, params: { amount: node.gain } };
      },
    });
    const context = new OfflineAudioContext(1, 4800, 48000);
    const { createEngine } = await import('../../src');
    const engine = await createEngine({ context, nodes: [doubler] });
    const chain = engine.chain().sampler({ id: 'dc', buffer: ones(0.1) }) as unknown as {
      doubler(init?: object): { to(bus: string): unknown };
    };
    chain.doubler({ id: 'x2' }).to('main');
    engine.select('#dc').trigger({ at: 0 });
    (engine.select('#x2') as unknown as { amount(value: number): unknown }).amount(3);
    expect(valueAt(await engine.render(), 0.05)).toBeCloseTo(3, 6);
  });

  it('refuse a node type whose name is a chain method', async () => {
    const engine = await offlineEngine(0.1);
    const bad = defineNode({
      type: 'split',
      category: 'utility',
      params: {},
      build: () => ({ params: {} }),
    });
    expect(() => engine.registry.register(bad)).toThrowError(/already have a method/);
  });
});

describe('commands', () => {
  it('do what the matching methods do', async () => {
    const viaMethods = await offlineEngine(1);
    viaMethods.chain().sampler({ id: 'hit', buffer: click() }).gain({ id: 'level' }).to('main');
    viaMethods.select('#level').set({ gain: 0.5 }, { at: 0 });
    viaMethods.select('#hit').trigger({ at: 0.25 });
    const expected = await viaMethods.render();

    const viaCommands = await offlineEngine(1);
    viaCommands.chain().sampler({ id: 'hit', buffer: click() }).gain({ id: 'level' }).to('main');
    const commands: Command[] = [
      { op: 'set', target: '#level', at: 0, values: { gain: 0.5 } },
      { op: 'trigger', target: { ids: ['hit'] }, at: 0.25 },
    ];
    viaCommands.root.dispatch(commands);
    const actual = await viaCommands.render();

    expect(Array.from(actual.getChannelData(0))).toEqual(Array.from(expected.getChannelData(0)));
    expect(actual.getChannelData(0)[12000]).toBeCloseTo(0.5, 6);
  });

  it('can edit connections and remove nodes', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2);
    engine.chain().gain({ id: 'level', gain: 0.5 }).to('main');
    engine.chain().gain({ id: 'unused' });
    engine.root.dispatch([
      { op: 'connect', target: '#dc', to: { node: 'level' } },
      { op: 'dispose', target: '#unused' },
      { op: 'bus', name: 'side', gain: 0.5 },
    ]);
    expect(engine.select('#unused')).toHaveLength(0);
    expect(engine.root.snapshot().buses).toEqual([
      { name: 'main', to: null, gain: 1 },
      { name: 'side', to: 'main', gain: 0.5 },
    ]);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.5, 6);
  });

  it('report a bad command as an error event and carry on with the rest', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().gain({ id: 'level' }).to('main');
    const errors: GraphError[] = [];
    engine.on('error', (error) => errors.push(error));
    engine.root.dispatch([
      { op: 'set', target: '#level', at: 0, values: { gain: Number.NaN } },
      { op: 'nonsense' } as unknown as Command,
      { op: 'call', target: '#level', at: 0, method: 'explode' },
      { op: 'set', target: '#level', at: 0, values: { gain: 0.3 } },
    ]);
    expect(errors.map((error) => error.code)).toEqual([
      'invalid-param',
      'invalid-command',
      'invalid-command',
    ]);
    expect(engine.select('#level').param('gain').value).toBe(0.3);
  });

  it('cannot reach outside the scope they are dispatched to', async () => {
    const engine = await offlineEngine(0.1);
    engine.scope('a').chain().gain({ id: 'level' }).to('main');
    engine.scope('b').chain().gain({ id: 'level' }).to('main');
    engine.scope('a').dispatch([{ op: 'set', target: '*', at: 0, values: { gain: 0.1 } }]);
    expect(engine.scope('a').select('#level').param('gain').value).toBe(0.1);
    expect(engine.scope('b').select('#level').param('gain').value).toBe(1);
  });
});
