import { describe, expect, it } from 'vitest';
import { createEngine, defineMacro } from '../../src';
import type { BusInserts, Command, Engine, ScopeApi } from '../../src';
import { SAMPLE_RATE, constant, makeBuffer, offlineEngine, valueAt } from './setup';

const ids = (nodes: Iterable<{ id: string }>): string[] => [...nodes].map((node) => node.id);

const LENGTH = 0.25;

/** A signal that is not constant, so that a different order of processing gives different samples. */
const wobble = (): AudioBuffer =>
  makeBuffer(LENGTH, (_, time) => 0.9 * Math.sin(2 * Math.PI * 220 * time) + 0.2);

/** Renders what `build` makes around one source sent to the bus `drums`. */
async function render(build: (engine: Engine) => void): Promise<Float32Array> {
  const engine = await offlineEngine(LENGTH);
  engine.bus('drums');
  engine.chain().sampler({ id: 'src', buffer: wobble() }).to('drums');
  build(engine);
  engine.select('#src').trigger({ at: 0 });
  return (await engine.render()).getChannelData(0);
}

const same = (a: Float32Array, b: Float32Array): void => {
  expect(a.length).toBe(b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  expect(worst).toBe(0);
};

const differs = (a: Float32Array, b: Float32Array): void => {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  expect(worst).toBeGreaterThan(0.01);
};

describe('bus inserts', () => {
  it('processes everything sent to the bus, exactly as the long form does', async () => {
    const short = await render((engine) => {
      engine.bus('drums').overdrive({ id: 'grit', drive: 0.6 }).lowpass(900);
    });
    const long = await render((engine) => {
      engine
        .bus('drums')
        .to(null)
        .chain()
        .overdrive({ id: 'grit', drive: 0.6 })
        .lowpass(900)
        .to('main');
    });
    same(short, long);
    differs(short, await render(() => undefined));
  });

  it('lets nothing round the inserts', async () => {
    const engine = await offlineEngine(0.2);
    engine.bus('drums');
    constant(engine, 0.2).to('drums');
    engine.bus('drums').insert().gain({ id: 'mute', gain: 0 });
    const audio = (await engine.render()).getChannelData(0);
    expect(Math.max(...audio.map(Math.abs))).toBe(0);
  });

  it('runs the inserts in the order they were added', async () => {
    const driveFirst = await render((engine) => {
      engine.bus('drums').overdrive({ drive: 0.8 }).lowpass(400);
    });
    const filterFirst = await render((engine) => {
      engine.bus('drums').lowpass(400).overdrive({ drive: 0.8 });
    });
    differs(driveFirst, filterFirst);
    same(
      filterFirst,
      await render((engine) => {
        engine.bus('drums').to(null).chain().lowpass(400).overdrive({ drive: 0.8 }).to('main');
      }),
    );
  });

  it('keeps `gain` as the level of the bus, after the inserts, and reaches the gain node through insert()', async () => {
    const engine = await offlineEngine(0.2);
    const bus = engine.bus('drums');
    constant(engine, 0.2).to('drums');
    expect(typeof bus.gain.set).toBe('function');
    const inserts = bus.insert().gain(0.5).gain({ id: 'quarter', gain: 0.25 });
    bus.gain.set(0.5);
    expect(ids(inserts.nodes)).toEqual(['gain-0', 'quarter']);
    expect(ids(bus.inserts)).toEqual(['gain-0', 'quarter']);
    expect(inserts.bus).toBe(bus);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.0625, 7);
  });

  it('returns something whose to() routes the bus and whose chain() taps it', async () => {
    const engine = await offlineEngine(0.2);
    engine.bus('sub');
    engine.bus('sub').gain.set(0.5);
    constant(engine, 0.2).to('sub');
    engine.bus('drums').insert().gain(0.5).to('sub');
    constant(engine, 0.2, 'b').to('drums');
    expect(engine.root.snapshot().buses.find((bus) => bus.name === 'drums')?.to).toBe('sub');
    // sub: 1 direct + 0.5 from drums = 1.5, at sub's level of 0.5.
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.75, 6);
  });

  it('taps the bus after its inserts with chain()', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2).to(engine.bus('drums'));
    engine.bus('drums').to(null).insert().gain(0.5).chain().gain(0.5).to('main');
    engine.bus('drums').chain().gain(0.125).to('main');
    // Both taps see the bus after its insert: 0.5 * 0.5 + 0.5 * 0.125.
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.3125, 6);
  });

  it('makes inserts ordinary nodes: selected, set, described, disposed', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2).to(engine.bus('drums'));
    engine
      .bus('drums')
      .insert()
      .gain({ id: 'a', class: 'fx', gain: 0.5 })
      .gain({ id: 'b', gain: 0.5 });
    expect(ids(engine.select('.fx'))).toEqual(['a']);
    expect(ids(engine.select('gain'))).toEqual(['a', 'b']);
    engine.select('#a').set({ gain: 0.25 });
    const graph = engine.root.describe();
    expect(graph.inserts).toEqual({ drums: ['a', 'b'] });
    expect(graph.nodes.map((node) => node.id)).toEqual(['dc', 'a', 'b']);
    // The path through the bus is not a connection of the graph.
    expect(graph.edges).toEqual([{ from: 'dc', to: { bus: 'drums' } }]);
    engine.select('#b').dispose();
    expect(ids(engine.bus('drums').inserts)).toEqual(['a']);
    expect(engine.root.describe().inserts).toEqual({ drums: ['a'] });
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.25, 6);
  });

  it('restores the direct path when the last insert is disposed', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2).to(engine.bus('drums'));
    engine.bus('drums').insert().gain({ id: 'a', gain: 0 });
    engine.select('#a').dispose();
    expect(engine.root.describe().inserts).toBeUndefined();
    expect(valueAt(await engine.render(), 0.1)).toBe(1);
  });

  it('bypasses an insert, at a time, and back', async () => {
    const engine = await offlineEngine(0.4);
    constant(engine, 0.4).to(engine.bus('drums'));
    engine.bus('drums').insert().gain({ id: 'a', gain: 0.5 }).gain({ id: 'b', gain: 0.5 });
    engine.select('#a').bypass(true, { at: 0.1 }).bypass(false, { at: 0.3 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.05)).toBeCloseTo(0.25, 6);
    expect(valueAt(audio, 0.2)).toBeCloseTo(0.5, 6);
    expect(valueAt(audio, 0.35)).toBeCloseTo(0.25, 6);
  });

  it('accepts an insert made bypassed', async () => {
    const engine = await offlineEngine(0.1);
    constant(engine, 0.1).to(engine.bus('drums'));
    engine.bus('drums').insert().gain({ id: 'a', gain: 0.5, bypass: true });
    expect(valueAt(await engine.render(), 0.05)).toBe(1);
  });

  it('adds another insert each time outside a build, and refuses a repeated id', async () => {
    const engine = await offlineEngine(0.1);
    constant(engine, 0.1).to(engine.bus('drums'));
    const line = (): unknown => engine.bus('drums').insert().gain(0.5);
    line();
    line();
    expect(ids(engine.bus('drums').inserts)).toEqual(['gain-0', 'gain-1']);
    engine.bus('drums').overdrive({ id: 'grit' });
    expect(() => engine.bus('drums').overdrive({ id: 'grit' })).toThrow(/already has a node/);
    expect(ids(engine.bus('drums').inserts)).toEqual(['gain-0', 'gain-1', 'grit']);
  });

  it('refuses a node that has no input, and leaves nothing behind', async () => {
    const engine = await offlineEngine(0.1);
    expect(() => engine.bus('drums').sine(220)).toThrow(/needs an input and an output/);
    expect(() => engine.bus('drums').lfo()).toThrow(/no input/);
    expect(engine.select('*').length).toBe(0);
    expect(engine.bus('drums').inserts.length).toBe(0);
  });

  it('works on main', async () => {
    const engine = await offlineEngine(0.1);
    constant(engine, 0.1).to('main');
    engine.bus('main').insert().gain(0.5);
    expect(valueAt(await engine.render(), 0.05)).toBeCloseTo(0.5, 6);
  });
});

describe('bus inserts and scopes', () => {
  it('lets a scope insert on its own bus but not on an outer one', async () => {
    const engine = await offlineEngine(0.2);
    const track = engine.scope('track');
    constant(engine, 0.2).to('main');
    track.bus('local').insert().gain({ id: 'half', gain: 0.5 });
    track
      .chain()
      .sampler({ id: 'dc', buffer: makeBuffer(0.2, () => 1) })
      .to('local');
    track.select('#dc').trigger({ at: 0 });
    expect(ids(track.select('gain'))).toEqual(['half']);
    expect(engine.root.describe().inserts).toBeUndefined();
    expect(track.describe().inserts).toEqual({ local: ['half'] });

    expect(() => track.bus('main').insert().gain(0)).toThrow(/belongs to scope "root"/);
    expect(() => track.$.bus('main').compressor()).toThrow(/belongs to scope "root"/);
    expect(track.select('*').length).toBe(2);
    expect(engine.bus('main').inserts.length).toBe(0);
    // Reading an outer bus's inserts is allowed.
    engine.bus('main').insert().gain({ id: 'm', gain: 1 });
    expect(ids(track.bus('main').inserts)).toEqual(['m']);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(1.5, 6);
  });

  it('refuses a `bus` command that names inserts for an outer bus', async () => {
    const engine = await offlineEngine(0.1);
    const track = engine.scope('track');
    track.chain().gain({ id: 'g' });
    const errors: string[] = [];
    track.on('error', (error) => errors.push(error.message));
    track.dispatch([{ op: 'bus', name: 'main', inserts: ['g'] }]);
    expect(errors).toEqual([
      'Bus "main" belongs to an outer scope and cannot be changed from "track".',
    ]);
    expect(engine.bus('main').inserts.length).toBe(0);
  });

  it('works on the buses inside a macro', async () => {
    const squash = defineMacro({
      type: 'squash',
      params: {
        amount: { default: 0.5, min: 0, max: 1, drives: [{ select: '#level', param: 'gain' }] },
      },
      build(__) {
        __.bus('in').chain().gain(1).to('out');
        __.bus('out').insert().gain({ id: 'level' }).gain({ id: 'half', gain: 0.5 });
      },
    });
    const context = new OfflineAudioContext(1, SAMPLE_RATE * 0.2, SAMPLE_RATE);
    const engine = await createEngine({ context, nodes: [squash] });
    (constant(engine, 0.2) as unknown as { squash(init: object): { to(bus: string): void } })
      .squash({ id: 'sq', amount: 0.5 })
      .to('main');
    expect(ids(engine.select('squash gain'))).toEqual(['gain-0', 'level', 'half']);
    expect(engine.select('#sq').first()!.insideScope!.describe().inserts).toEqual({
      out: ['level', 'half'],
    });
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.25, 6);
  });
});

describe('bus inserts as data and commands', () => {
  it('round-trips through describe() and apply()', async () => {
    const make = async (): Promise<Engine> => {
      const engine = await offlineEngine(LENGTH);
      engine.bus('drums');
      return engine;
    };
    const first = await make();
    first.chain().sampler({ id: 'src', buffer: 'wobble' }).to('drums');
    first.bus('drums').overdrive({ id: 'grit', drive: 0.6 }).lowpass({ id: 'lp', frequency: 900 });
    const graph = structuredClone(first.root.describe());
    expect(graph.inserts).toEqual({ drums: ['grit', 'lp'] });

    const second = await make();
    second.buffers.add('wobble', wobble());
    const result = await second.root.apply(graph);
    expect(result.errors).toEqual([]);
    expect(second.root.describe()).toEqual(graph);
    expect(ids(second.bus('drums').inserts)).toEqual(['grit', 'lp']);
    // Applying it again changes nothing.
    const again = await second.root.apply(second.root.describe());
    expect(ids(again.unchanged)).toEqual(['src', 'grit', 'lp']);

    second.select('#src').trigger({ at: 0 });
    const audio = (await second.render()).getChannelData(0);
    same(
      audio,
      await render((engine) => {
        engine.bus('drums').overdrive({ drive: 0.6 }).lowpass(900);
      }),
    );
  });

  it('applies a reordering, a removal, and a description with no inserts', async () => {
    const engine = await offlineEngine(0.1);
    engine.bus('drums').insert().gain({ id: 'a' }).gain({ id: 'b' }).gain({ id: 'c' });
    const graph = engine.root.describe();
    const kept = engine.select('#a').first();

    let result = await engine.root.apply({ ...graph, inserts: { drums: ['c', 'a'] } });
    expect(ids(engine.bus('drums').inserts)).toEqual(['c', 'a']);
    expect(engine.select('#a').first()).toBe(kept);
    // `b` is still a node, only no longer in the bus.
    expect(ids(engine.select('gain'))).toEqual(['a', 'b', 'c']);
    expect(ids(result.updated)).toEqual(['a', 'b', 'c']);

    result = await engine.root.apply({ nodes: graph.nodes, edges: [] });
    expect(engine.bus('drums').inserts.length).toBe(0);
    expect(ids(result.updated)).toEqual(['a', 'c']);
    expect(engine.root.describe().inserts).toBeUndefined();
  });

  it('reports an insert the description cannot place and keeps the rest', async () => {
    const engine = await offlineEngine(0.1);
    engine.bus('drums');
    const result = await engine.root.apply({
      nodes: [
        { id: 'a', type: 'gain' },
        { id: 'osc', type: 'sine' },
      ],
      edges: [],
      inserts: { drums: ['a'], nowhere: ['a'] },
    });
    expect(result.errors.map((error) => error.message)).toEqual([
      'Scope "root" has no bus of its own called "nowhere" to put inserts on.',
    ]);
    expect(ids(engine.bus('drums').inserts)).toEqual(['a']);

    const bad = await engine.root.apply({
      nodes: [
        { id: 'a', type: 'gain' },
        { id: 'osc', type: 'sine' },
      ],
      edges: [],
      inserts: { drums: ['a', 'osc', 'ghost'] },
    });
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]!.message).toMatch(/needs an input and an output|does not contain/);
    // The bus keeps what it had.
    expect(ids(engine.bus('drums').inserts)).toEqual(['a']);
  });

  it('sets the inserts of a bus with the `bus` command', async () => {
    const engine = await offlineEngine(0.2);
    constant(engine, 0.2).to(engine.bus('drums'));
    engine.chain().gain({ id: 'a', gain: 0.5 });
    engine.chain().gain({ id: 'b', gain: 0.5 });
    const commands: Command[] = [{ op: 'bus', name: 'drums', inserts: ['a', 'b'] }];
    engine.root.dispatch(structuredClone(commands));
    expect(ids(engine.bus('drums').inserts)).toEqual(['a', 'b']);
    engine.root.dispatch([{ op: 'bus', name: 'drums', inserts: ['b'] }]);
    expect(ids(engine.bus('drums').inserts)).toEqual(['b']);
    const errors: string[] = [];
    engine.root.on('error', (error) => errors.push(error.message));
    engine.root.dispatch([{ op: 'bus', name: 'drums', inserts: ['nope'] }]);
    expect(errors[0]).toMatch(/names the node "nope" as an insert/);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.5, 6);
  });

  it('moves a node from one bus to another', async () => {
    const engine = await offlineEngine(0.1);
    engine.bus('a').insert().gain({ id: 'g' });
    engine.root.dispatch([{ op: 'bus', name: 'b', inserts: ['g'] }]);
    expect(engine.bus('a').inserts.length).toBe(0);
    expect(ids(engine.bus('b').inserts)).toEqual(['g']);
  });
});

describe('rebuilding bus inserts', () => {
  const script =
    (options: { drive?: number; second?: boolean; swap?: boolean; insert?: boolean } = {}) =>
    (__: ScopeApi): void => {
      __().sampler({ id: 'src', buffer: 'wobble' }).to(__.bus('drums'));
      if (options.insert === false) return;
      const first = (bus: BusInserts): BusInserts =>
        bus.overdrive({ id: 'grit', drive: options.drive ?? 0.6 });
      const second = (bus: BusInserts): BusInserts => bus.lowpass({ id: 'lp', frequency: 900 });
      const inserts = __.bus('drums').insert();
      if (options.swap) first(second(inserts));
      else if (options.second === false) first(inserts);
      else second(first(inserts));
    };

  const setup = async (): Promise<Engine> => {
    const engine = await offlineEngine(LENGTH);
    engine.buffers.add('wobble', wobble());
    return engine;
  };

  const finish = async (engine: Engine): Promise<Float32Array> => {
    engine.select('#src').trigger({ at: 0 });
    return (await engine.render()).getChannelData(0);
  };

  it('keeps the nodes when the same inserts are declared again', async () => {
    const engine = await setup();
    await engine.root.build(script());
    const before = engine.select('#grit, #lp').nodes;
    const outputs = before.map((node) => node.output);
    const result = await engine.root.build(script());
    expect(ids(result.unchanged)).toEqual(['src', 'grit', 'lp']);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(engine.select('#grit, #lp').nodes).toEqual(before);
    expect(engine.select('#grit, #lp').nodes.map((node) => node.output)).toEqual(outputs);
    expect(ids(engine.bus('drums').inserts)).toEqual(['grit', 'lp']);
    same(await finish(engine), await finish(await built(setup, script())));
  });

  const built = async (
    make: () => Promise<Engine>,
    fn: (__: ScopeApi) => void,
  ): Promise<Engine> => {
    const engine = await make();
    await engine.root.build(fn);
    return engine;
  };

  it('does not touch the audio path when nothing changed', async () => {
    const engine = await setup();
    await engine.root.build(script());
    const entry = engine.bus('drums').input;
    const calls: string[] = [];
    for (const name of ['connect', 'disconnect'] as const) {
      const original = entry[name].bind(entry) as (...args: unknown[]) => unknown;
      (entry as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        calls.push(name);
        return original(...args);
      };
    }
    await engine.root.build(script());
    expect(calls).toEqual([]);
    await engine.root.build(script({ swap: true }));
    expect(calls).toContain('connect');
  });

  it('updates a changed option in place', async () => {
    const engine = await setup();
    await engine.root.build(script());
    const grit = engine.select('#grit').first();
    const result = await engine.root.build(script({ drive: 0.9 }));
    expect(engine.select('#grit').first()).toBe(grit);
    expect(grit!.param('drive').value).toBe(0.9);
    expect(ids(result.updated)).toEqual(['grit']);
    same(await finish(engine), await finish(await built(setup, script({ drive: 0.9 }))));
  });

  it('removes an insert whose line is gone, and restores the direct path when all are', async () => {
    const engine = await setup();
    await engine.root.build(script());
    let result = await engine.root.build(script({ second: false }));
    expect(result.removed).toEqual(['lp']);
    expect(ids(engine.bus('drums').inserts)).toEqual(['grit']);

    result = await engine.root.build(script({ insert: false }));
    expect(result.removed).toEqual(['grit']);
    expect(engine.bus('drums').inserts.length).toBe(0);
    expect(engine.root.describe().inserts).toBeUndefined();
    same(await finish(engine), await finish(await built(setup, script({ insert: false }))));
  });

  it('re-patches when the order changes, keeping the nodes', async () => {
    const engine = await setup();
    await engine.root.build(script());
    const before = new Set(engine.select('#grit, #lp').nodes);
    const result = await engine.root.build(script({ swap: true }));
    expect(ids(engine.bus('drums').inserts)).toEqual(['lp', 'grit']);
    expect(engine.select('#grit, #lp').nodes.every((node) => before.has(node))).toBe(true);
    expect(result.added).toEqual([]);
    expect(ids(result.updated).sort()).toEqual(['grit', 'lp']);
    const audio = await finish(engine);
    same(audio, await finish(await built(setup, script({ swap: true }))));
    differs(audio, await finish(await built(setup, script())));
  });

  it('leaves the bus as it was when the build throws', async () => {
    const engine = await setup();
    await engine.root.build(script());
    await expect(
      engine.root.build((__) => {
        __().sampler({ id: 'src', buffer: 'wobble' }).to(__.bus('drums'));
        __.bus('drums').lowpass({ id: 'lp', frequency: 200 }).reverb({ id: 'new' });
        throw new Error('typo');
      }),
    ).rejects.toThrow('typo');
    expect(ids(engine.bus('drums').inserts)).toEqual(['grit', 'lp']);
    expect(ids(engine.select('*'))).toEqual(['src', 'grit', 'lp']);
    expect(engine.select('#lp').first()!.param('frequency').value).toBe(900);
    same(await finish(engine), await finish(await built(setup, script())));
  });

  it('matches inserts without ids by position, and tells them from chain nodes of the same type', async () => {
    const engine = await setup();
    const fn =
      (level: number) =>
      (__: ScopeApi): void => {
        __().sampler({ id: 'src', buffer: 'wobble' }).gain(0.5).to(__.bus('drums'));
        __.bus('drums').insert().gain(level).lowpass(700);
      };
    await engine.root.build(fn(0.5));
    const nodes = engine.select('gain, lowpass').nodes;
    const result = await engine.root.build(fn(0.25));
    expect(engine.select('gain, lowpass').nodes).toEqual(nodes);
    expect(ids(result.updated)).toEqual(['gain-1']);
    expect(ids(engine.bus('drums').inserts)).toEqual(['gain-1', 'lowpass-0']);
  });

  it('turns an insert into a chain node, and back, under the same id', async () => {
    const engine = await setup();
    await engine.root.build(script());
    const lp = engine.select('#lp').first();
    await engine.root.build((__) => {
      __()
        .sampler({ id: 'src', buffer: 'wobble' })
        .lowpass({ id: 'lp', frequency: 900 })
        .to(__.bus('drums'));
      __.bus('drums').overdrive({ id: 'grit', drive: 0.6 });
    });
    expect(engine.select('#lp').first()).toBe(lp);
    expect(ids(engine.bus('drums').inserts)).toEqual(['grit']);
    expect(engine.root.describe().edges).toContainEqual({ from: 'lp', to: { bus: 'drums' } });
    await engine.root.build(script());
    expect(engine.select('#lp').first()).toBe(lp);
    expect(ids(engine.bus('drums').inserts)).toEqual(['grit', 'lp']);
    expect(lp!.inputs).toEqual([]);
    same(await finish(engine), await finish(await built(setup, script())));
  });

  it('rebuilds a child scope that inserts on its own bus without touching outer buses', async () => {
    const engine = await setup();
    engine.bus('main').insert().gain({ id: 'master', gain: 0.5 });
    const track = engine.scope('track');
    const fn = (__: ScopeApi): void => {
      __().sampler({ id: 'src', buffer: 'wobble' }).to(__.bus('drums'));
      __.bus('drums').overdrive({ id: 'grit', drive: 0.6 });
    };
    await track.build(fn);
    await track.build(fn);
    expect(ids(track.bus('drums').inserts)).toEqual(['grit']);
    expect(ids(engine.bus('main').inserts)).toEqual(['master']);
    await track.build(() => undefined);
    expect(track.describe()).toEqual({ nodes: [], edges: [] });
    expect(ids(engine.bus('main').inserts)).toEqual(['master']);
  });
});
