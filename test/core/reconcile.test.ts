import { describe, expect, it } from 'vitest';
import type { Command, Engine, GraphError, ScopeApi } from '../../src';
import { constant, offlineEngine, ones, valueAt } from './setup';

const ids = (nodes: Iterable<{ id: string }>): string[] => [...nodes].map((node) => node.id);

describe('bypass', () => {
  it('passes the input of a bypassed effect straight through', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2).gain({ id: 'half', gain: 0.5 }).to('main');
    const node = engine.select('#half').first()!;
    expect(node.bypass).toBe(false);
    node.bypass = true;
    expect(node.bypass).toBe(true);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(1, 6);
  });

  it('switches at the time given, and back', async () => {
    const engine = await offlineEngine(0.4);
    constant(engine, 0.4).gain({ id: 'half', gain: 0.5 }).to('main');
    engine.select('#half').bypass(true, { at: 0.1 }).bypass(false, { at: 0.3 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.05)).toBeCloseTo(0.5, 6);
    expect(valueAt(audio, 0.2)).toBeCloseTo(1, 6);
    expect(valueAt(audio, 0.35)).toBeCloseTo(0.5, 6);
  });

  it('silences a bypassed source', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2, 'a').to('main');
    constant(engine, 0.2, 'b').gain(0.25).to('main');
    engine.select('#a').bypass();
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.25, 6);
  });

  it('keeps working for connections made after the node was bypassed', async () => {
    const engine = await offlineEngine(0.2);
    const half = engine.chain().gain({ id: 'half', gain: 0.5 });
    engine.select('#half').bypass().bypass(false, { at: 0 });
    constant(engine, 0.2).connect('#half');
    half.gain(0.5).to('main');
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.25, 6);
  });

  it('can be given when the node is made, with no fade', async () => {
    const engine = await offlineEngine(0.1);
    constant(engine, 0.1).gain({ id: 'half', gain: 0.5, bypass: true }).to('main');
    const audio = await engine.render();
    expect(valueAt(audio, 0)).toBeCloseTo(1, 6);
    expect(engine.root.describe().nodes.find((node) => node.id === 'half')?.bypass).toBe(true);
  });

  it('stops a bypassed modulator from modulating', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2).gain({ id: 'target', gain: 0.5 }).to('main');
    constant(engine, 0.2, 'mod').gain({ id: 'depth', gain: 0.25 }).modulate('#target', 'gain');
    // Bypassing the source silences it. Bypassing `depth` would pass the full signal through instead.
    engine.select('#mod').bypass();
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.5, 6);
  });

  it('is a command', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2).gain({ id: 'half', gain: 0.5 }).to('main');
    const command: Command = { op: 'bypass', target: '#half', at: 0, bypass: true };
    engine.root.dispatch([command]);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(1, 6);
  });
});

describe('build', () => {
  const patch =
    (cutoff: number) =>
    (__: ScopeApi): void => {
      __().saw({ id: 'osc', frequency: 110 }).lowpass(cutoff).gain(0.5).to('main');
    };

  it('keeps every node when the same builder runs again', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('a');
    const first = await scope.build(patch(500));
    expect(ids(first.added)).toEqual(['osc', 'lowpass-0', 'gain-0']);
    const nodes = scope.select('*').nodes;

    const second = await scope.build(patch(500));
    expect(second.added).toEqual([]);
    expect(second.removed).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(ids(second.unchanged)).toEqual(['osc', 'lowpass-0', 'gain-0']);
    expect(scope.select('*').nodes).toEqual(nodes);
    expect(nodes.every((node) => !node.disposed)).toBe(true);
  });

  it('updates a changed value in place and resets one that is no longer given', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('a');
    await scope.build(patch(500));
    const filter = scope.select('lowpass').first()!;

    const result = await scope.build(patch(900));
    expect(ids(result.updated)).toEqual(['lowpass-0']);
    expect(ids(result.unchanged)).toEqual(['osc', 'gain-0']);
    expect(scope.select('lowpass').first()).toBe(filter);
    expect(filter.params.frequency.value).toBe(900);

    await scope.build((__) => {
      __().saw({ id: 'osc' }).lowpass().gain(0.5).to('main');
    });
    expect(filter.params.frequency.value).toBe(filter.params.frequency.meta.default);
    expect(scope.select('#osc').param('frequency').value).toBe(
      scope.select('#osc').param('frequency').meta.default,
    );
  });

  it('matches nodes without ids by position among their type', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('a');
    await scope.build((__) => {
      __().saw().lowpass(500).gain(0.5).lowpass(2000).to('main');
    });
    const [first, second] = scope.select('lowpass').nodes;

    const result = await scope.build((__) => {
      __().saw().delay(0.1).lowpass(500).gain(0.5).lowpass(2000).to('main');
    });
    expect(ids(result.added)).toEqual(['delay-0']);
    expect(scope.select('lowpass').nodes).toEqual([first, second]);
    expect(ids(scope.select('*'))).toEqual([
      'saw-0',
      'delay-0',
      'lowpass-0',
      'gain-0',
      'lowpass-1',
    ]);
    // The saw now feeds the delay instead of the first filter.
    expect(ids(first!.inputs.map((edge) => edge.from))).toEqual(['delay-0']);
    expect(ids(result.updated)).toEqual(['saw-0', 'lowpass-0']);
  });

  it('disposes nodes the builder no longer makes and removes connections it no longer asks for', async () => {
    const engine = await offlineEngine(0.2);
    const scope = engine.scope('a');
    engine.buffers.add('ones', ones(0.2));
    await scope.build((__) => {
      const source = __().sampler({ id: 'dc', buffer: 'ones' });
      source.to('main');
      source.gain({ id: 'extra', gain: 0.5 }).to('main');
    });
    const extra = scope.select('#extra').first()!;
    const source = scope.select('#dc').first()!;
    expect(source.outputs).toHaveLength(2);

    const result = await scope.build((__) => {
      __().sampler({ id: 'dc', buffer: 'ones' }).to('main');
    });
    expect(result.removed).toEqual(['extra']);
    expect(extra.disposed).toBe(true);
    expect(source.outputs).toHaveLength(1);
    expect(ids(result.updated)).toEqual(['dc']);

    scope.select('#dc').trigger({ at: 0 });
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(1, 6);
  });

  it('replaces a node whose type or creation options changed', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('a');
    engine.buffers.add('one', ones(0.05));
    engine.buffers.add('two', ones(0.05));
    await scope.build((__) => {
      __().sine({ id: 'osc' }).to('main');
      __().sampler({ id: 'hit', buffer: 'one' }).to('main');
    });
    const [osc, hit] = scope.select('*').nodes;

    const same = await scope.build((__) => {
      __().sine({ id: 'osc' }).to('main');
      __()
        .sampler({ id: 'hit', buffer: engine.buffers.get('one')! })
        .to('main');
    });
    expect(same.added).toEqual([]);

    const result = await scope.build((__) => {
      __().saw({ id: 'osc' }).to('main');
      __().sampler({ id: 'hit', buffer: 'two' }).to('main');
    });
    expect(result.removed).toEqual(['osc', 'hit']);
    expect(ids(result.added)).toEqual(['osc', 'hit']);
    expect(osc!.disposed && hit!.disposed).toBe(true);
    expect(scope.select('#osc').first()?.type).toBe('saw');
    expect(scope.select('*')).toHaveLength(2);
  });

  it('shows the builder only what it has made so far', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('a');
    await scope.build((__) => {
      __().sine({ id: 'old' }).to('main');
    });
    let seen: string[] = [];
    await scope.build((__) => {
      __().sine({ id: 'new' }).to('main');
      seen = ids(__('*'));
    });
    expect(seen).toEqual(['new']);
  });

  it('leaves the scope as it was when the builder throws', async () => {
    const engine = await offlineEngine(1);
    const scope = engine.scope('a');
    const fired: string[] = [];
    await scope.build((__) => {
      __().sine({ id: 'osc', frequency: 220 }).gain({ id: 'level', gain: 0.5 }).to('main');
      __.transport.sequence('seq', { steps: [1], step: '1/4' }, () => fired.push('old'));
    });
    const before = scope.describe();
    const nodes = scope.select('*').nodes;
    const errors: GraphError[] = [];
    engine.on('error', (error) => errors.push(error));

    await expect(
      scope.build((__) => {
        __().saw({ id: 'osc', frequency: 880 }).gain({ id: 'level', gain: 1 }).to('main');
        __().sine({ id: 'other' }).connect('#level');
        __.bus('fx');
        __.transport.sequence('seq', { steps: [1], step: '1/8' }, () => fired.push('new'));
        __.transport.every('1/4', () => fired.push('every'));
        throw new Error('half-typed');
      }),
    ).rejects.toMatchObject({ code: 'build-failed', message: 'half-typed' });

    expect(scope.describe()).toEqual(before);
    expect(scope.select('*').nodes).toEqual(nodes);
    expect(scope.select('#osc').first()?.type).toBe('sine');
    expect(() => scope.select('*').to('fx')).toThrow(/no bus called "fx"/);

    engine.transport.start();
    await engine.render();
    expect(fired).toEqual(['old', 'old']);
    expect(errors).toEqual([]);
  });

  it('replaces what was scheduled: nothing doubles and nothing stale keeps firing', async () => {
    const engine = await offlineEngine(1);
    const scope = engine.scope('a');
    const fired: string[] = [];
    const builder =
      (tag: string, withB: boolean) =>
      (__: ScopeApi): void => {
        __.transport.sequence('a', { steps: [1], step: '1/4' }, () => fired.push(`${tag}:a`));
        if (withB) __.transport.sequence('b', { steps: [1], step: '1/4' }, () => fired.push('b'));
        __.transport.every('1/4', () => fired.push(`${tag}:every`));
        __.transport.sequence({ steps: [1], step: '1/4' }, () => fired.push(`${tag}:unnamed`));
      };
    await scope.build(builder('one', true));
    const sequence = scope.transport.get('a');
    await scope.build(builder('two', false));
    expect(scope.transport.get('a')).toBe(sequence);
    expect(scope.transport.get('b')).toBeUndefined();

    engine.transport.start();
    await engine.render();
    expect(fired.filter((name) => name.startsWith('one') || name === 'b')).toEqual([]);
    expect(fired.sort()).toEqual(
      ['two:a', 'two:a', 'two:every', 'two:every', 'two:unnamed', 'two:unnamed'].sort(),
    );
  });

  it('removes buses an earlier build made, but not ones made outside a build', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('a');
    scope.bus('host');
    await scope.build((__) => {
      __().sine().to(__.bus('fx'));
    });
    expect(scope.snapshot().buses.map((bus) => bus.name)).toEqual(['host', 'fx']);
    await scope.build((__) => {
      __().sine().to('host');
    });
    expect(scope.snapshot().buses.map((bus) => bus.name)).toEqual(['host']);
    expect(scope.select('sine').first()?.outputs).toHaveLength(1);
  });

  it('announces additions after removals, once the build has succeeded', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('a');
    const events: string[] = [];
    scope.on('node:added', (node) => events.push(`+${node.type}`));
    scope.on('node:removed', (id) => events.push(`-${id}`));
    await scope.build((__) => {
      __().sine({ id: 'osc' }).gain().to('main');
    });
    expect(events).toEqual(['+sine', '+gain']);
    events.length = 0;
    await scope.build((__) => {
      __().saw({ id: 'osc' }).to('main');
    });
    expect(events).toEqual(['-osc', '-gain-0', '+saw']);
    events.length = 0;
    await scope
      .build(() => {
        throw new Error('no');
      })
      .catch(() => undefined);
    expect(events).toEqual([]);
  });

  it('carries values, classes, tags and bypass over to a kept node', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('a');
    await scope.build((__) => {
      __()
        .sine()
        .gain({ id: 'g', class: 'wet', tags: { role: 'send' } })
        .to('main');
    });
    const node = scope.select('#g').first()!;
    const result = await scope.build((__) => {
      __()
        .sine()
        .gain({ id: 'g', class: 'dry loud', tags: { role: 'main' }, bypass: true })
        .to('main');
    });
    expect(ids(result.updated)).toEqual(['g']);
    expect(scope.select('.dry.loud').first()).toBe(node);
    expect(scope.select('.wet')).toHaveLength(0);
    expect(scope.select('[role=main]').first()).toBe(node);
    expect(node.bypass).toBe(true);
  });

  it('refuses to nest', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('a');
    let inner: Promise<unknown> = Promise.resolve();
    await scope.build(() => {
      inner = scope.build(() => undefined);
    });
    await expect(inner).rejects.toMatchObject({ code: 'build-failed' });
  });
});

describe('apply', () => {
  async function described(): Promise<{ engine: Engine; value: number }> {
    const engine = await offlineEngine(0.2);
    engine.buffers.add('ones', ones(0.2));
    const source = engine.chain().sampler({ id: 'dc', buffer: 'ones' });
    source.gain({ id: 'a', gain: 0.5 }).to('main');
    source.gain({ id: 'b', gain: 0.25, class: 'wet' }).gain({ id: 'c', bypass: true }).to('main');
    engine.chain().sampler({ id: 'mod', buffer: 'ones' }).gain(0.5).modulate('#c', 'gain');
    return { engine, value: 0.75 };
  }

  it('rebuilds a described graph in an empty scope', async () => {
    const { engine: original, value } = await described();
    const graph = JSON.parse(JSON.stringify(original.root.describe())) as ReturnType<
      Engine['root']['describe']
    >;

    const engine = await offlineEngine(0.2);
    engine.buffers.add('ones', ones(0.2));
    const result = await engine.root.apply(graph);
    expect(result.errors).toEqual([]);
    expect(ids(result.added)).toEqual(graph.nodes.map((node) => node.id));
    expect(engine.root.describe()).toEqual(graph);

    engine.select('sampler').trigger({ at: 0 });
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(value, 6);
  });

  it('changes nothing when the graph already matches', async () => {
    const { engine } = await described();
    const nodes = engine.select('*').nodes;
    const result = await engine.root.apply(engine.root.describe());
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.unchanged).toEqual(nodes);
  });

  it('adds, updates and removes to match an edited description', async () => {
    const { engine } = await described();
    const graph = engine.root.describe();
    const kept = engine.select('#a').first()!;
    const result = await engine.root.apply({
      nodes: [
        ...graph.nodes
          .filter((node) => !['b', 'c', 'mod', 'gain-0'].includes(node.id))
          .map((node) => (node.id === 'a' ? { ...node, params: { gain: 0.1 } } : node)),
        { id: 'fx', type: 'gain', params: { gain: 2 } },
      ],
      edges: [
        { from: 'dc', to: { node: 'a' } },
        { from: 'a', to: { node: 'fx' } },
        { from: 'fx', to: { bus: 'main' } },
      ],
    });
    expect(result.errors).toEqual([]);
    expect(ids(result.added)).toEqual(['fx']);
    expect([...result.removed].sort()).toEqual(['b', 'c', 'gain-0', 'mod']);
    expect(ids(result.updated).sort()).toEqual(['a', 'dc']);
    expect(engine.select('#a').first()).toBe(kept);

    engine.select('#dc').trigger({ at: 0 });
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.2, 6);
  });

  it('reports a bad node or connection and applies the rest', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().sine({ id: 'keep', frequency: 300 }).to('main');
    const keep = engine.select('#keep').first()!;
    const result = await engine.root.apply({
      nodes: [
        { id: 'keep', type: 'no-such-type' },
        { id: 'ok', type: 'gain' },
        { id: 'ok', type: 'gain' },
      ],
      edges: [
        { from: 'keep', to: { node: 'ok' } },
        { from: 'ok', to: { node: 'ghost' } },
        { from: 'ok', to: { bus: 'nowhere' } },
        { from: 'ok', to: { bus: 'main' } },
      ],
    });
    expect(result.errors.map((error) => error.code)).toEqual([
      'unknown-type',
      'duplicate-id',
      'missing-target',
      'missing-target',
    ]);
    expect(ids(result.added)).toEqual(['ok']);
    // The node that could not be remade is left as it was.
    expect(keep.disposed).toBe(false);
    expect(
      ids(
        engine
          .select('#ok')
          .first()!
          .inputs.map((edge) => edge.from),
      ),
    ).toEqual(['keep']);
  });

  it('leaves connections that go outside the scope alone', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('a');
    const outside = engine.chain().gain({ id: 'outside' }).to('main').tail.first()!;
    scope.chain().sine({ id: 'osc' }).connect(outside);
    const result = await scope.apply(scope.describe());
    expect(ids(result.unchanged)).toEqual(['osc']);
    expect(outside.inputs).toHaveLength(1);
  });

  it('is a command, with failures reported as error events', async () => {
    const engine = await offlineEngine(0.1);
    const errors: GraphError[] = [];
    engine.on('error', (error) => errors.push(error));
    engine.root.dispatch([
      {
        op: 'apply',
        graph: {
          nodes: [
            { id: 'osc', type: 'sine' },
            { id: 'bad', type: 'nope' },
          ],
          edges: [{ from: 'osc', to: { bus: 'main' } }],
        },
      },
    ]);
    expect(ids(engine.select('*'))).toEqual(['osc']);
    expect(errors.map((error) => error.code)).toEqual(['unknown-type']);
  });
});
