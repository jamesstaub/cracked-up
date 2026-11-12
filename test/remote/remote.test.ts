import { describe, expect, it } from 'vitest';
import type { Command, HostMessage, RemoteError, RemoteMessage, ScopeApi } from '../../src';
import { createRemote, linkRemote } from '../../src/remote';
import type { LinkOptions, Remote } from '../../src/remote';
import { click, offlineEngine, ones, valueAt } from '../core/setup';

/**
 * A host scope and a remote wired straight to each other. Every message is passed through
 * `structuredClone`, as `postMessage` would, so anything that is not plain data fails here.
 */
async function linked(seconds: number, allow?: LinkOptions['allow']) {
  const engine = await offlineEngine(seconds);
  engine.buffers.add('ones', ones(seconds));
  engine.buffers.add('click', click());
  // Let the store announce those before the link starts listening.
  await Promise.resolve();
  await Promise.resolve();
  const scope = engine.scope('script');
  const sent: RemoteMessage[] = [];
  const received: HostMessage[] = [];
  const holder: { remote?: Remote } = {};
  const link = linkRemote(scope, {
    send: (message) => {
      received.push(message);
      holder.remote?.receive(structuredClone(message));
    },
    ...(allow ? { allow } : {}),
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
  return { engine, scope, link, remote, __: remote.__, sent, received, errors };
}

const ops = (message: RemoteMessage | undefined): string[] =>
  message?.type === 'commands' ? message.commands.map((command) => command.op) : [];

describe('remote graph building', () => {
  it('builds on the host what a chain describes in the sandbox', async () => {
    const { engine, scope, remote, __ } = await linked(0.2);
    __().sampler({ id: 'dc', buffer: 'ones' }).gain(0.5).to('main');
    __('#dc').trigger();
    remote.flush();
    expect(scope.select('*').nodes.map((node) => node.id)).toEqual(['dc', 'gain-0']);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.5, 6);
  });

  it('sends one message per turn of the event loop', async () => {
    const { sent, __ } = await linked(0.1);
    __().sampler({ id: 'dc', buffer: 'ones' }).gain(0.5).to('main');
    __('#dc').trigger();
    __('gain').gain(0.25);
    expect(sent).toHaveLength(0);
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(ops(sent[0])).toEqual(['apply', 'trigger', 'set']);
  });

  it('answers reads from its mirror', async () => {
    const { scope, remote, __ } = await linked(0.1);
    __().sine({ id: 'osc' }).gain({ id: 'g', class: 'wet', gain: 0.5 }).to('main');
    expect(__('#osc').param('frequency').value).toBe(__('#osc').param('frequency').meta.default);
    expect(__('.wet').param('gain').value).toBe(0.5);
    __('#g').gain(0.25);
    expect(__('#g').param('gain').value).toBe(0.25);
    expect(__('*')).toHaveLength(2);
    expect(
      __('#g')
        .first()
        ?.inputs.map((edge) => (edge.from as { id: string }).id),
    ).toEqual(['osc']);
    remote.flush();
    expect(scope.select('#g').param('gain').value).toBe(0.25);
    expect(remote.describe()).toEqual(scope.describe());
  });

  it('routes through a bus and keeps that routing across later changes', async () => {
    const { engine, scope, remote, __ } = await linked(0.2);
    __.bus('fx').chain().gain({ id: 'wet', gain: 0.5 }).to('main');
    __().sampler({ id: 'dc', buffer: 'ones' }).to('fx');
    remote.flush();
    __().gain({ id: 'later' });
    __('#dc').trigger();
    remote.flush();
    expect(scope.describe().edges).toContainEqual({ from: { bus: 'fx' }, to: { node: 'wet' } });
    // The bus feeds main itself, and its chain adds half as much again.
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(1.5, 6);
  });

  it('reaches inside a macro by selector, which the host resolves', async () => {
    const { scope, remote, __ } = await linked(0.1);
    __().monosynth({ id: 'syn' }).to('main');
    __('#syn').select('lowpass').set({ frequency: 321 });
    __('#syn lowpass').set({ q: 3 });
    remote.flush();
    const filter = scope.select('#syn lowpass');
    expect(filter).toHaveLength(1);
    expect(filter.param('frequency').value).toBe(321);
    expect(filter.param('q').value).toBe(3);
  });

  it('throws in the sandbox for mistakes it can see', async () => {
    const { __ } = await linked(0.1);
    expect(() => (__() as unknown as { nope(): void }).nope()).toThrow();
    __().sine({ id: 'a' });
    expect(() => __().sine({ id: 'a' })).toThrow(/already a node/);
    expect(() => __('##')).toThrow(/selector/i);
    expect(() => __().sine().connect('#missing')).toThrow(/Nothing matches/);
  });
});

describe('remote sequences', () => {
  it('runs the callback in the sandbox and lands its commands on the event', async () => {
    const { engine, remote, __ } = await linked(1);
    const seen: number[][] = [];
    __().sampler({ id: 'hit', buffer: 'click' }).to('main');
    remote.transport.sequence('hits', { steps: [1, 0, 2], step: '1/8' }, (ev) => {
      seen.push([ev.index, ev.value, ev.beat]);
      if (ev.value) __('#hit').trigger({ velocity: ev.value / 2 });
      expect(ev.at(0.5)).toBeCloseTo(ev.time + ev.duration / 2, 9);
    });
    remote.flush();
    engine.transport.start();
    const audio = (await engine.render()).getChannelData(0);
    expect(seen.slice(0, 4)).toEqual([
      [0, 1, 0],
      [1, 0, 0.5],
      [2, 2, 1],
      [0, 1, 1.5],
    ]);
    // 120 bpm at 48 kHz: an eighth note is 12000 samples.
    expect(audio[0]).toBeCloseTo(0.5, 6);
    expect(audio[12000]).toBe(0);
    expect(audio[24000]).toBeCloseTo(1, 6);
    expect(audio[36000]).toBeCloseTo(0.5, 6);
    expect(audio[36001]).toBe(0);
  });

  it('edits steps, mutes and stops', async () => {
    const { engine, scope, remote } = await linked(1);
    const values: number[] = [];
    const sequence = remote.transport.steps('s', 'x.', (_index, value) => values.push(value));
    sequence.setStep(1, 5);
    expect(sequence.steps).toEqual([1, 5]);
    remote.flush();
    expect(scope.transport.get('s')?.steps).toEqual([1, 5]);
    engine.transport.start();
    await engine.render();
    expect(values.slice(0, 4)).toEqual([1, 5, 1, 5]);

    sequence.stop();
    remote.flush();
    expect(scope.transport.get('s')).toBeUndefined();
    expect(remote.transport.get('s')).toBeUndefined();
  });

  it('reports a callback that throws without stopping the sequence', async () => {
    const { engine, remote, errors } = await linked(0.6);
    let calls = 0;
    remote.transport.sequence('s', { steps: 1, step: '1/4' }, () => {
      calls++;
      throw new Error('oops');
    });
    remote.flush();
    engine.transport.start();
    await engine.render();
    expect(calls).toBe(2);
    expect(errors).toEqual([
      { code: 'callback', message: 'oops' },
      { code: 'callback', message: 'oops' },
    ]);
  });

  it('reads and sets tempo', async () => {
    const { engine, remote } = await linked(0.1);
    expect(remote.transport.bpm).toBe(120);
    expect(remote.transport.seconds('1/4')).toBeCloseTo(0.5, 9);
    remote.transport.bpm = 90;
    remote.flush();
    expect(engine.transport.bpm).toBe(90);
    engine.transport.bpm = 150;
    expect(remote.transport.bpm).toBe(150);
  });
});

describe('remote build', () => {
  it('rebuilds in place: the host keeps unchanged nodes and drops undeclared sequences', async () => {
    const { scope, remote, sent } = await linked(0.1);
    const program = (cutoff: number, withB: boolean) => () =>
      remote.build((__) => {
        __().saw({ id: 'osc' }).lowpass(cutoff).gain(0.5).to('main');
        __.transport.sequence('a', { steps: 'x.' }, () => undefined);
        if (withB) __.transport.sequence('b', { steps: 'x.' }, () => undefined);
      });
    program(500, true)();
    expect(sent).toHaveLength(1);
    const nodes = scope.select('*').nodes;
    const a = scope.transport.get('a');
    expect(scope.transport.get('b')).toBeDefined();

    program(900, false)();
    expect(scope.select('*').nodes).toEqual(nodes);
    expect(scope.select('lowpass').param('frequency').value).toBe(900);
    expect(scope.transport.get('a')).toBe(a);
    expect(scope.transport.get('b')).toBeUndefined();
    expect(remote.transport.get('b')).toBeUndefined();
  });

  it('sends nothing and keeps its mirror when the builder throws', async () => {
    const { scope, remote, sent } = await linked(0.1);
    remote.build((__) => {
      __().sine({ id: 'osc' }).to('main');
      __.transport.sequence('a', { steps: 'x.' }, () => undefined);
    });
    const before = remote.describe();
    const sequence = remote.transport.get('a');
    sent.length = 0;
    expect(() =>
      remote.build((__) => {
        __().saw({ id: 'other' }).to('main');
        __.transport.sequence('a', { steps: 'xx' }, () => undefined);
        __('#other').trigger();
        throw new Error('half-typed');
      }),
    ).toThrow('half-typed');
    await Promise.resolve();
    expect(sent).toEqual([]);
    expect(remote.describe()).toEqual(before);
    expect(remote.transport.get('a')).toBe(sequence);
    expect(scope.select('*').nodes.map((node) => node.id)).toEqual(['osc']);
  });
});

describe('the link', () => {
  it('tells the remote about values and nodes changed on the host', async () => {
    const { scope, remote, __ } = await linked(0.1);
    __().sine({ id: 'osc' }).gain({ id: 'g', gain: 0.5 }).to('main');
    remote.flush();
    const changes: unknown[] = [];
    __('#g')
      .param('gain')
      .on('change', (change) => changes.push(change.value));

    scope.select('#g').set({ gain: 0.1 });
    await Promise.resolve();
    expect(__('#g').param('gain').value).toBe(0.1);
    expect(changes).toEqual([0.1]);

    scope.chain().gain({ id: 'from-host' });
    await Promise.resolve();
    expect(__('#from-host')).toHaveLength(1);
  });

  it('does not echo the remote’s own changes back', async () => {
    const { remote, received, __ } = await linked(0.1);
    __().sine({ id: 'osc' }).gain({ id: 'g' }).to('main');
    __('#g').gain(0.3);
    remote.flush();
    await Promise.resolve();
    expect(received).toEqual([]);
  });

  it('sends errors back to the remote', async () => {
    const { remote, errors, __ } = await linked(0.1);
    __().sine({ id: 'osc' }).to('nowhere');
    __('#osc').call('nope');
    remote.flush();
    expect(errors.map((error) => error.code)).toEqual(['missing-target', 'invalid-command']);
    expect(errors[0]?.message).toMatch(/no bus called "nowhere"/);
  });

  it('keeps commands inside the linked scope', async () => {
    const { engine, link, errors, __, remote } = await linked(0.1);
    engine.chain().gain({ id: 'outside', gain: 1 }).to('main');
    __.bus('main').gain.set(0);
    remote.flush();
    link.receive({
      type: 'commands',
      commands: [
        { op: 'set', target: '#outside', at: 0, values: { gain: 0 } },
        { op: 'set', target: { ids: ['outside'] }, at: 0, values: { gain: 0 } },
        { op: 'dispose', target: '*' },
        {
          op: 'apply',
          graph: { nodes: [], edges: [{ from: { bus: 'main' }, to: { bus: 'main' } }] },
        },
        null as unknown as Command,
        { op: 'launch' } as unknown as Command,
      ],
    });
    expect(engine.bus('main').gain.value).toBe(1);
    expect(engine.select('#outside').param('gain').value).toBe(1);
    expect(errors.map((error) => error.code)).toEqual([
      'invalid-command',
      'missing-target',
      'invalid-command',
      'invalid-command',
    ]);
  });

  it('survives anything a hostile script could send', async () => {
    const { engine, link, scope } = await linked(0.1);
    engine.on('error', () => undefined);
    const junk: unknown[] = [
      null,
      42,
      'commands',
      {},
      { type: 'commands' },
      { type: 'commands', commands: 'no' },
      { type: 'define' },
      { type: 'define', macro: { type: 'x', params: { a: null } } },
      { type: 'define', macro: { type: '__proto__', params: {}, graph: null, methods: 5 } },
      {
        type: 'commands',
        commands: [
          7,
          { op: 'set' },
          { op: 'set', target: null, at: 0, values: null },
          { op: 'set', target: '*', at: 'soon', values: { gain: 1 } },
          { op: 'apply', graph: null },
          { op: 'apply', graph: { nodes: [null, 3, { id: {}, type: [] }], edges: [null, {}] } },
          {
            op: 'apply',
            graph: { nodes: [{ id: 'a', type: 'gain', params: { gain: 'loud' } }], edges: [] },
          },
          { op: 'inside', node: 'nope', commands: [] },
          { op: 'inside', node: {}, commands: 'x' },
          { op: 'sequence', name: 5, options: null },
          { op: 'sequence', name: 's', options: { steps: 'not a pattern!' } },
          { op: 'once', name: 'o', position: {} },
          { op: 'bus', name: null, to: {} },
          { op: 'connect', target: '*', to: null },
          { op: 'trigger', target: { ids: 'abc' }, at: 0 },
          { op: 'call', target: '*', at: 0, method: {} },
          { op: 'setStep', name: {}, index: 'x', value: null },
          { op: 'transport', set: null },
          { op: '__proto__' },
        ],
      },
    ];
    for (const message of junk) {
      expect(() => link.receive(message as never)).not.toThrow();
    }
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    // The scope still works afterwards.
    scope.chain().sine({ id: 'fine' }).to('main');
    expect(scope.select('#fine')).toHaveLength(1);
  });

  it('lets the host refuse commands', async () => {
    const refused: string[] = [];
    const { engine, remote, scope, __ } = await linked(0.1, (command) => {
      if (command.op !== 'transport' && command.op !== 'loadBuffer') return true;
      refused.push(command.op);
      return false;
    });
    remote.transport.bpm = 300;
    __().sine({ id: 'osc' }).to('main');
    remote.flush();
    expect(refused).toEqual(['transport']);
    expect(engine.transport.bpm).toBe(120);
    expect(scope.select('#osc')).toHaveLength(1);
  });

  it('removes the remote’s sequences and stops forwarding when disposed', async () => {
    const { scope, link, remote, received, __ } = await linked(0.1);
    __().gain({ id: 'g' });
    remote.transport.sequence('a', { steps: 'x' }, () => undefined);
    remote.flush();
    expect(scope.transport.get('a')).toBeDefined();
    link.dispose();
    expect(scope.transport.get('a')).toBeUndefined();
    scope.select('#g').set({ gain: 0.2 });
    await Promise.resolve();
    __('#g').gain(0.9);
    remote.flush();
    expect(received).toEqual([]);
    expect(scope.select('#g').param('gain').value).toBe(0.2);
  });
});

describe('remote scheduling without names', () => {
  it('runs unnamed sequences, every and at, and a rebuild does not double them', async () => {
    const { engine, remote } = await linked(1);
    const fired: string[] = [];
    const program = (tag: string) => (__: ScopeApi) => {
      __.transport.sequence({ steps: [1], step: '1/4' }, (ev) =>
        fired.push(`${tag}:seq@${ev.beat}`),
      );
      __.transport.steps('x', (index) => fired.push(`${tag}:steps#${index}`));
      __.transport.every('1/4', (ev) => fired.push(`${tag}:every@${ev.beat}`), { offset: '1/8' });
      __.transport.at(1, (ev) => fired.push(`${tag}:at@${ev.beat}`));
    };
    remote.build(program('one'));
    remote.build(program('two'));
    engine.transport.start();
    await engine.render();
    expect(fired.filter((entry) => entry.startsWith('one'))).toEqual([]);
    expect(fired.filter((entry) => !entry.includes('steps')).sort()).toEqual(
      ['two:seq@0', 'two:seq@1', 'two:every@0.5', 'two:every@1.5', 'two:at@1'].sort(),
    );
    expect(fired.filter((entry) => entry.includes('steps')).length).toBe(8);
  });

  it('stops what its unsubscribe functions and clear() name', async () => {
    const { engine, scope, remote } = await linked(0.6);
    const fired: string[] = [];
    const stopEvery = remote.transport.every('1/4', () => fired.push('every'));
    const stopAt = remote.transport.at(0.5, () => fired.push('at'));
    remote.transport.sequence({ steps: 'x' }, () => fired.push('seq'));
    stopEvery();
    stopAt();
    remote.transport.clear();
    remote.flush();
    expect(scope.transport.get('sequence:0')).toBeUndefined();
    engine.transport.start();
    await engine.render();
    expect(fired).toEqual([]);
  });

  it('restarts a sequence and hears about tempo changes', async () => {
    const { engine, scope, remote } = await linked(0.1);
    const sequence = remote.transport.sequence('s', { steps: 'x...' }, () => undefined);
    remote.flush();
    let restarted = 0;
    const host = scope.transport.get('s')!;
    const original = host.restart.bind(host);
    host.restart = () => {
      restarted++;
      return original();
    };
    sequence.restart();
    remote.flush();
    expect(restarted).toBe(1);

    const tempos: number[] = [];
    remote.transport.on('tempo', (bpm) => tempos.push(bpm));
    engine.transport.bpm = 99;
    expect(tempos).toEqual([99]);
    expect(remote.transport.timeSignature).toEqual([4, 4]);
  });
});

describe('remote buffers', () => {
  it('knows the host’s buffers, including ones loaded later', async () => {
    const { engine, remote } = await linked(0.1);
    expect(remote.buffers.get('click')).toEqual({
      key: 'click',
      duration: 0.01,
      slices: [0, 0.01],
    });
    expect(remote.buffers.get('later')).toBeUndefined();
    engine.buffers.add('later', ones(0.05));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(remote.buffers.get('later')?.duration).toBeCloseTo(0.05, 6);
  });

  it('asks the host to load, which the host can refuse', async () => {
    const asked: string[] = [];
    const { remote } = await linked(0.1, (command) => {
      if (command.op !== 'loadBuffer') return true;
      asked.push(`${command.key}=${command.url}`);
      return false;
    });
    remote.buffers.load('https://example.invalid/a.wav', { key: 'a' });
    remote.flush();
    expect(asked).toEqual(['a=https://example.invalid/a.wav']);
  });
});

describe('macros defined in the sandbox', () => {
  /** An effect: its input through a gain, with a doubled `amount` and a method that sets the gain. */
  const boost = {
    type: 'boost',
    category: 'utility' as const,
    description: 'Test effect.',
    shorthand: 'amount',
    params: {
      amount: {
        default: 0.5,
        min: 0,
        max: 4,
        drives: [{ select: '#g', param: 'gain', scale: { multiply: 2 } }],
      },
    },
    build(__: ScopeApi) {
      __.bus('in').chain().gain({ id: 'g' }).to('out');
    },
    methods: {
      level(__: ScopeApi, args: Readonly<Record<string, unknown>>) {
        __('#g').set({ gain: args['to'] as number });
      },
    },
  };

  it('builds the inner graph on the host and drives it from exposed parameters', async () => {
    const { engine, scope, remote, errors } = await linked(0.2);
    remote.define(boost);
    const chain = remote.__().sampler({ id: 'dc', buffer: 'ones' }) as unknown as {
      boost(init: unknown): { to(bus: string): void };
    };
    chain.boost({ id: 'b', amount: 0.25 }).to('main');
    remote.__('#dc').trigger();
    remote.flush();
    expect(errors).toEqual([]);
    expect(engine.registry.describe('boost').isMacro).toBe(true);
    expect(scope.select('#b > gain')).toHaveLength(1);
    expect(remote.__('#b').param('amount').value).toBe(0.25);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.5, 6);
  });

  it('runs a method in the sandbox when the script or the host calls it', async () => {
    const { engine, scope, remote } = await linked(0.4);
    remote.define(boost);
    remote.build((__) => {
      (
        __().sampler({ id: 'dc', buffer: 'ones' }) as unknown as {
          boost(v: number): { to(b: string): void };
        }
      )
        .boost(0.5)
        .to('main');
      __('#dc').trigger();
      __('boost').call('level', { to: 0.25 }, { at: 0.1 });
    });
    // From the host, as a control or another collaborator would.
    scope.select('boost').call('level', { to: 0.75 }, { at: 0.3 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.05)).toBeCloseTo(1, 6);
    expect(valueAt(audio, 0.2)).toBeCloseTo(0.25, 6);
    expect(valueAt(audio, 0.35)).toBeCloseTo(0.75, 6);
  });

  it('triggers in time from a sequence, and builds each instance from its own options', async () => {
    const { engine, scope, remote, errors } = await linked(1);
    remote.define({
      type: 'pinger',
      params: {},
      build(__, init) {
        const count = typeof init['count'] === 'number' ? init['count'] : 1;
        for (let i = 0; i < count; i++) __().sampler({ class: 'hit', buffer: 'click' }).to('out');
      },
      trigger(__, options) {
        __('.hit').trigger({ velocity: (options['velocity'] as number | undefined) ?? 1 });
      },
    });
    remote.build((__) => {
      const chain = __() as unknown as { pinger(init: unknown): { to(bus: string): void } };
      chain.pinger({ id: 'one' }).to('main');
      chain.pinger({ id: 'three', count: 3 });
      __.transport.sequence('s', { steps: [1, 0.5], step: '1/4' }, (ev) => {
        __('#one').trigger({ velocity: ev.value });
      });
    });
    expect(errors).toEqual([]);
    expect(scope.select('#one > sampler')).toHaveLength(1);
    expect(scope.select('#three > sampler')).toHaveLength(3);
    engine.transport.start();
    const audio = (await engine.render()).getChannelData(0);
    expect(audio[0]).toBeCloseTo(1, 6);
    expect(audio[24000]).toBeCloseTo(0.5, 6);
    expect(audio[24001]).toBe(0);
    expect(audio[12000]).toBe(0);
  });

  it('keeps an unchanged instance across a rebuild and replaces one whose definition changed', async () => {
    const { scope, remote } = await linked(0.1);
    const program = (definition: typeof boost) => () => {
      remote.define(definition);
      remote.build((__) => {
        (__().sine() as unknown as { boost(v: number): { to(b: string): void } })
          .boost(1)
          .to('main');
      });
    };
    program(boost)();
    const instance = scope.select('boost').first();
    program(boost)();
    expect(scope.select('boost').first()).toBe(instance);

    program({
      ...boost,
      build(__: ScopeApi) {
        __.bus('in').chain().gain({ id: 'g' }).gain({ id: 'extra' }).to('out');
      },
    })();
    expect(scope.select('boost').first()).not.toBe(instance);
    expect(scope.select('boost > #extra')).toHaveLength(1);
  });

  it('serves instances the host created, and instances nested in other macros', async () => {
    const { scope, remote, errors } = await linked(0.1);
    remote.define(boost);
    remote.define({
      type: 'wrapper',
      params: {},
      build(__) {
        (__.bus('in').chain() as unknown as { boost(init: unknown): { to(b: string): void } })
          .boost({ id: 'inner' })
          .to('out');
      },
    });
    remote.flush();
    await scope.apply({
      nodes: [
        { id: 'made-on-host', type: 'boost' },
        { id: 'wrap', type: 'wrapper' },
      ],
      edges: [],
    });
    await Promise.resolve();
    expect(remote.__('#made-on-host')).toHaveLength(1);

    scope.select('#made-on-host').call('level', { to: 0.3 });
    scope.select('#wrap #inner').call('level', { to: 0.7 });
    expect(errors).toEqual([]);
    expect(scope.select('#made-on-host > #g').param('gain').value).toBe(0.3);
    expect(scope.select('#wrap #inner > #g').param('gain').value).toBe(0.7);
  });

  it('refuses what cannot work, and reports failures inside an instance', async () => {
    const { engine, link, remote, errors } = await linked(0.1);
    expect(() =>
      remote.define({
        ...boost,
        params: {
          amount: {
            default: 1,
            min: 0,
            max: 2,
            drives: [{ select: '#g', param: 'gain', scale: (v) => v * 2 }],
          },
        },
      }),
    ).toThrow(/cannot be a function/);
    expect(() => remote.define({ ...boost, type: 'gain' })).toThrow(/already a node type/);

    // A forged definition that tries to take over a built-in type.
    link.receive({
      type: 'define',
      macro: { type: 'sine', params: {}, graph: { nodes: [], edges: [] }, methods: [] },
    });
    expect(engine.registry.describe('sine').isMacro).toBe(false);
    expect(errors.map((error) => error.code)).toEqual(['unknown-type']);

    errors.length = 0;
    remote.define({
      type: 'broken',
      params: {},
      build(__) {
        __().sine().to('out');
      },
      methods: {
        bad(__) {
          __('sine').call('nope');
        },
        throws() {
          throw new Error('in the sandbox');
        },
      },
    });
    (remote.__() as unknown as { broken(init: unknown): unknown }).broken({ id: 'x' });
    remote.__('#x').call('bad').call('throws');
    remote.flush();
    expect(errors.map((error) => [error.code, error.message])).toEqual([
      ['invalid-command', expect.stringContaining('no method called "nope"')],
      ['callback', 'in the sandbox'],
    ]);
  });

  it('removes its types when the link is disposed', async () => {
    const { engine, link, remote } = await linked(0.1);
    remote.define(boost);
    remote.flush();
    expect(engine.registry.has('boost')).toBe(true);
    link.dispose();
    expect(engine.registry.has('boost')).toBe(false);
  });
});
