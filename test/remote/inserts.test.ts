import { describe, expect, it } from 'vitest';
import type { HostMessage, RemoteError, RemoteMessage, ScopeApi } from '../../src';
import { createRemote, linkRemote } from '../../src/remote';
import type { Remote } from '../../src/remote';
import { makeBuffer, offlineEngine, ones, valueAt } from '../core/setup';

const LENGTH = 0.25;
const ids = (nodes: Iterable<{ id: string }>): string[] => [...nodes].map((node) => node.id);

/** As in remote.test.ts: a host scope and a remote, with every message cloned on the way. */
async function linked(scopeName = 'script') {
  const engine = await offlineEngine(LENGTH);
  engine.buffers.add('ones', ones(LENGTH));
  engine.buffers.add(
    'wobble',
    makeBuffer(LENGTH, (_, time) => 0.9 * Math.sin(2 * Math.PI * 220 * time) + 0.2),
  );
  await Promise.resolve();
  await Promise.resolve();
  const scope = scopeName === 'root' ? engine.root : engine.scope(scopeName);
  const sent: RemoteMessage[] = [];
  const holder: { remote?: Remote } = {};
  const link = linkRemote(scope, {
    send: (message: HostMessage) => holder.remote?.receive(structuredClone(message)),
  });
  const remote = createRemote({
    ...structuredClone(link.state()),
    send: (message) => {
      sent.push(message);
      link.receive(structuredClone(message));
    },
  });
  holder.remote = remote;
  const errors: RemoteError[] = [];
  remote.on('error', (error) => errors.push(error));
  return { engine, scope, link, remote, __: remote.__, sent, errors };
}

/** The script under test, as a user writes it. The same text runs directly and in the sandbox. */
const script =
  (options: { drive?: number; order?: 'swap' | 'one' | 'none' } = {}) =>
  (__: ScopeApi): void => {
    __().sampler({ id: 'src', buffer: 'wobble' }).to(__.bus('drums'));
    const drums = __.bus('drums');
    if (options.order === 'none') return;
    if (options.order === 'swap') {
      drums.lowpass({ id: 'lp', frequency: 900 }).overdrive({ id: 'grit', drive: 0.6 });
    } else if (options.order === 'one') drums.overdrive({ id: 'grit', drive: 0.6 });
    else
      drums
        .overdrive({ id: 'grit', drive: options.drive ?? 0.6 })
        .lowpass({ id: 'lp', frequency: 900 });
  };

async function direct(fn: (__: ScopeApi) => void): Promise<Float32Array> {
  const engine = await offlineEngine(LENGTH);
  engine.buffers.add(
    'wobble',
    makeBuffer(LENGTH, (_, time) => 0.9 * Math.sin(2 * Math.PI * 220 * time) + 0.2),
  );
  const scope = engine.scope('script');
  await scope.build(fn);
  scope.select('#src').trigger({ at: 0 });
  return (await engine.render()).getChannelData(0);
}

const same = (a: Float32Array, b: Float32Array): void => {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  expect(worst).toBe(0);
  expect(Math.max(...a.map(Math.abs))).toBeGreaterThan(0.1);
};

describe('bus inserts through a remote', () => {
  it('renders the same audio as the script run directly', async () => {
    const { engine, scope, remote, errors } = await linked();
    remote.build(script());
    expect(errors).toEqual([]);
    expect(ids(scope.bus('drums').inserts)).toEqual(['grit', 'lp']);
    expect(remote.describe()).toEqual(scope.describe());
    expect(remote.describe().inserts).toEqual({ drums: ['grit', 'lp'] });
    scope.select('#src').trigger({ at: 0 });
    same((await engine.render()).getChannelData(0), await direct(script()));
  });

  it('works outside a build, as plain commands', async () => {
    const { engine, scope, remote, __, sent, errors } = await linked();
    __().sampler({ id: 'dc', buffer: 'ones' }).to(__.bus('drums'));
    const inserts = __.bus('drums').insert().gain(0.5).gain({ id: 'half', gain: 0.5 });
    __.bus('drums').gain.set(0.5);
    __('#dc').trigger();
    expect(ids(inserts.nodes)).toEqual(['gain-0', 'half']);
    expect(ids(__.bus('drums').inserts)).toEqual(['gain-0', 'half']);
    remote.flush();
    expect(errors).toEqual([]);
    expect(sent).toHaveLength(1);
    const message = sent[0]!;
    expect(message.type === 'commands' && message.commands.map((command) => command.op)).toEqual([
      'bus',
      'bus',
      'bus',
      'bus',
      'bus',
      'apply',
      'trigger',
    ]);
    expect(ids(scope.bus('drums').inserts)).toEqual(['gain-0', 'half']);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.125, 6);
  });

  it('keeps `gain` as the level on the bus and has the node method on what an insert returns', async () => {
    const { __ } = await linked();
    const bus = __.bus('drums');
    expect(typeof bus.gain).toBe('object');
    expect(bus.gain.value).toBe(1);
    expect(typeof bus.compressor).toBe('function');
    expect(typeof bus.insert().gain).toBe('function');
    expect(bus.compressor().bus).toBe(bus);
  });

  it('rebuilds in place: kept, updated, reordered, removed', async () => {
    const { engine, scope, remote, errors } = await linked();
    remote.build(script());
    const nodes = scope.select('#grit, #lp').nodes;

    remote.build(script());
    expect(scope.select('#grit, #lp').nodes).toEqual(nodes);

    remote.build(script({ drive: 0.9 }));
    expect(scope.select('#grit, #lp').nodes).toEqual(nodes);
    expect(scope.select('#grit').param('drive').value).toBe(0.9);

    remote.build(script({ order: 'swap' }));
    expect(ids(scope.bus('drums').inserts)).toEqual(['lp', 'grit']);
    expect(new Set(scope.select('#grit, #lp').nodes)).toEqual(new Set(nodes));

    remote.build(script({ order: 'one' }));
    expect(ids(scope.bus('drums').inserts)).toEqual(['grit']);
    expect(ids(scope.select('*'))).toEqual(['src', 'grit']);

    remote.build(script({ order: 'none' }));
    expect(scope.bus('drums').inserts.length).toBe(0);
    expect(remote.describe().inserts).toBeUndefined();
    expect(errors).toEqual([]);
    scope.select('#src').trigger({ at: 0 });
    same((await engine.render()).getChannelData(0), await direct(script({ order: 'none' })));
  });

  it('sends nothing and keeps its inserts when the builder throws', async () => {
    const { scope, remote, sent } = await linked();
    remote.build(script());
    const before = remote.describe();
    sent.length = 0;
    expect(() =>
      remote.build((__) => {
        __.bus('drums').reverb({ id: 'new' });
        throw new Error('half-typed');
      }),
    ).toThrow('half-typed');
    await Promise.resolve();
    expect(sent).toEqual([]);
    expect(remote.describe()).toEqual(before);
    expect(ids(scope.bus('drums').inserts)).toEqual(['grit', 'lp']);
  });

  it('drops a disposed insert from the mirror and the host', async () => {
    const { scope, remote, __ } = await linked();
    __.bus('drums').insert().gain({ id: 'a' }).gain({ id: 'b' });
    remote.flush();
    __('#a').dispose();
    expect(ids(__.bus('drums').inserts)).toEqual(['b']);
    remote.flush();
    expect(ids(scope.bus('drums').inserts)).toEqual(['b']);
    expect(ids(scope.select('*'))).toEqual(['b']);
  });

  it('hears about inserts made on the host', async () => {
    const { scope, remote, __ } = await linked();
    scope.bus('drums').insert().gain({ id: 'host', gain: 0.5 });
    await Promise.resolve();
    expect(ids(__.bus('drums').inserts)).toEqual(['host']);
    expect(remote.describe()).toEqual(scope.describe());
    // A change sent now keeps the host's insert where it is.
    __('#host').gain(0.25);
    __().sine({ id: 'osc' }).to('drums');
    remote.flush();
    expect(ids(scope.bus('drums').inserts)).toEqual(['host']);
  });

  it('is told when an insert was put on a bus of an outer scope', async () => {
    const { engine, remote, __, errors } = await linked();
    __.bus('main').insert().gain({ id: 'no', gain: 0 });
    remote.flush();
    expect(errors.map((error) => error.message)).toEqual([
      'Scope "script" has no bus of its own called "main" to put inserts on.',
    ]);
    expect(engine.bus('main').inserts.length).toBe(0);
  });

  it('is told when a node with no input was made an insert', async () => {
    const { scope, remote, __, errors } = await linked();
    __.bus('drums').sine({ id: 'osc' });
    remote.flush();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/needs an input and an output/);
    expect(scope.bus('drums').inserts.length).toBe(0);
    expect(() => __.bus('drums').lfo()).toThrow(/needs an input and an output/);
  });

  it('carries inserts on the buses inside a macro defined in the sandbox', async () => {
    const { engine, scope, remote, errors } = await linked();
    remote.define({
      type: 'squash',
      params: {
        amount: { default: 0.5, min: 0, max: 1, drives: [{ select: '#level', param: 'gain' }] },
      },
      build(__) {
        __.bus('in').chain().gain(1).to('out');
        __.bus('out').insert().gain({ id: 'level' }).gain({ id: 'half', gain: 0.5 });
      },
    });
    const chain = remote.__().sampler({ id: 'dc', buffer: 'ones' }) as unknown as {
      squash(init: unknown): { to(bus: string): void };
    };
    chain.squash({ id: 'sq', amount: 0.5 }).to('main');
    remote.__('#dc').trigger();
    remote.flush();
    expect(errors).toEqual([]);
    expect(scope.select('#sq').first()!.insideScope!.describe().inserts).toEqual({
      out: ['level', 'half'],
    });
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.25, 6);
  });
});
